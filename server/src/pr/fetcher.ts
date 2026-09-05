import { nowIso } from '../db.js'
import type { PullRequestRefs } from '../forge/forge.js'
import { fetch as gitFetch, mergeBase, revParse } from '../git/plumbing.js'
import { GitError } from '../git/run.js'
import type { FetchStatus, Project } from '../shared/api.js'
import { githubPullHeadRef, prBaseRef, prHeadRef } from './refs.js'

const REMOTE = 'origin'

const key = (projectId: string, number: number): string => `${projectId}#${number}`

/** A background fetch: the oids it was started for, plus the newest request that arrived meanwhile. */
interface Inflight {
  refs: PullRequestRefs
  done: Promise<FetchStatus>
  /** Set when `ensure` saw different oids while this fetch ran; decided again once it finishes. */
  next?: PullRequestRefs
}

/** An `ensure` call still deciding whether to fetch. */
interface Deciding {
  refs: PullRequestRefs
  done: Promise<FetchStatus>
}

/**
 * Brings a pull request's objects into a project's repository, lazily and in
 * the background (design.md: "Fetch is lazy and non-blocking").
 *
 * `ensure` compares the namespaced refs with the oids GitHub reports and only
 * fetches when they differ, so re-opening a PR whose head moved re-fetches
 * while an unchanged PR is `ready` without touching the network. Status is
 * kept in memory per `${projectId}#${number}`; the refs themselves persist in
 * the repository.
 *
 * Requests are never dropped: when `ensure` is asked for other oids while a
 * fetch is in flight, the newest oids are decided again as soon as that fetch
 * finishes, so a head that moves mid-fetch still ends `ready` at the new oids.
 */
export class PrFetcher {
  private readonly statuses = new Map<string, FetchStatus>()
  /** Background fetches, by key. */
  private readonly inflight = new Map<string, Inflight>()
  /** `ensure` calls still deciding whether to fetch, by key; concurrent callers share one. */
  private readonly ensuring = new Map<string, Deciding>()

  status(projectId: string, number: number): FetchStatus {
    return this.statuses.get(key(projectId, number)) ?? { state: 'idle' }
  }

  /**
   * Make sure `refs` are fetched. Returns immediately: `ready` when the
   * repository already holds exactly these oids, otherwise `fetching` after
   * starting a background fetch (or while one is running).
   */
  ensure(project: Project, refs: PullRequestRefs): Promise<FetchStatus> {
    const k = key(project.id, refs.number)
    const running = this.inflight.get(k)
    if (running) {
      // The newest request wins; the oids already being fetched need nothing more.
      running.next = sameOids(running.refs, refs) ? undefined : refs
      return Promise.resolve(this.status(project.id, refs.number))
    }
    const deciding = this.ensuring.get(k)
    if (deciding) {
      if (sameOids(deciding.refs, refs)) return deciding.done
      return deciding.done.then(() => this.ensure(project, refs))
    }
    return this.beginDecision(project, refs, k)
  }

  /** Resolve once nothing is pending or running for the PR (tests and eager callers). */
  async waitFor(projectId: string, number: number): Promise<FetchStatus> {
    const k = key(projectId, number)
    for (;;) {
      const deciding = this.ensuring.get(k)
      if (deciding) {
        await deciding.done
        continue
      }
      const running = this.inflight.get(k)
      if (running) {
        await running.done
        continue
      }
      return this.status(projectId, number)
    }
  }

  private beginDecision(project: Project, refs: PullRequestRefs, k: string): Promise<FetchStatus> {
    const entry: Deciding = {
      refs,
      done: this.decide(project, refs, k).finally(() => {
        if (this.ensuring.get(k) === entry) this.ensuring.delete(k)
      }),
    }
    this.ensuring.set(k, entry)
    return entry.done
  }

  /** Never rejects: a failing check (e.g. no merge base) becomes an `error` status, like a failed fetch. */
  private async decide(project: Project, refs: PullRequestRefs, k: string): Promise<FetchStatus> {
    try {
      const repo = project.path
      const n = refs.number
      const [head, base] = await Promise.all([
        revParse(repo, prHeadRef(n)),
        revParse(repo, prBaseRef(n)),
      ])
      if (head && base && head === refs.headRefOid && base === refs.baseRefOid) {
        const current = this.statuses.get(k)
        if (current?.state === 'ready' && current.headOid === head && current.baseOid === base) {
          return current
        }
        const ready: FetchStatus = {
          state: 'ready',
          headOid: head,
          baseOid: base,
          mergeBaseOid: await mergeBase(repo, base, head),
          ...(current?.startedAt ? { startedAt: current.startedAt } : {}),
          finishedAt: current?.finishedAt ?? nowIso(),
        }
        this.statuses.set(k, ready)
        return ready
      }
      return this.start(project, refs, k)
    } catch (err) {
      const failed: FetchStatus = { state: 'error', error: describe(err), finishedAt: nowIso() }
      this.statuses.set(k, failed)
      return failed
    }
  }

  private start(project: Project, refs: PullRequestRefs, k: string): FetchStatus {
    const startedAt = nowIso()
    const fetching: FetchStatus = { state: 'fetching', startedAt }
    this.statuses.set(k, fetching)
    const entry: Inflight = {
      refs,
      done: this.runFetch(project, refs, startedAt).then((final) => {
        this.statuses.set(k, final)
        if (this.inflight.get(k) === entry) this.inflight.delete(k)
        // The oids changed while we fetched: check the repository against the newest ones.
        if (entry.next) void this.beginDecision(project, entry.next, k)
        return final
      }),
    }
    this.inflight.set(k, entry)
    return fetching
  }

  /** Never rejects: failures become an `error` status. */
  private async runFetch(
    project: Project,
    refs: PullRequestRefs,
    startedAt: string,
  ): Promise<FetchStatus> {
    const repo = project.path
    const n = refs.number
    const headSpec = `+${githubPullHeadRef(n)}:${prHeadRef(n)}`
    try {
      try {
        // GitHub serves any reachable commit by full oid, so the base is pinned to
        // exactly the oid the PR was compared against.
        await gitFetch(repo, REMOTE, [headSpec, `+${refs.baseRefOid}:${prBaseRef(n)}`])
      } catch (err) {
        if (!(err instanceof GitError) || !isValidRefName(refs.baseRefName)) throw err
        // Servers that refuse wants by oid still serve the branch tip.
        await gitFetch(repo, REMOTE, [headSpec, `+refs/heads/${refs.baseRefName}:${prBaseRef(n)}`])
      }
      const [headOid, baseOid] = await Promise.all([
        revParse(repo, prHeadRef(n)),
        revParse(repo, prBaseRef(n)),
      ])
      if (!headOid || !baseOid) throw new Error(`refs for PR #${n} are missing after the fetch`)
      const mergeBaseOid = await mergeBase(repo, baseOid, headOid)
      return { state: 'ready', headOid, baseOid, mergeBaseOid, startedAt, finishedAt: nowIso() }
    } catch (err) {
      return { state: 'error', error: describe(err), startedAt, finishedAt: nowIso() }
    }
  }
}

const sameOids = (a: PullRequestRefs, b: PullRequestRefs): boolean =>
  a.headRefOid === b.headRefOid && a.baseRefOid === b.baseRefOid

function isValidRefName(name: string): boolean {
  return (
    name.length > 0 && !name.startsWith('-') && !/[\s~^:?*[\\]/.test(name) && !name.includes('..')
  )
}

/** Human-readable failure: git's stderr (already redacted by the runner) or the error message. */
function describe(err: unknown): string {
  if (err instanceof GitError) {
    const stderr = err.stderr.trim()
    return stderr ? `${err.message}\n${stderr}`.slice(0, 2000) : err.message
  }
  return err instanceof Error ? err.message : String(err)
}
