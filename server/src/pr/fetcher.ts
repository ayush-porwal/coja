import { nowIso } from '../db.js'
import type { PullRequestRefs } from '../forge/forge.js'
import { fetch as gitFetch, mergeBase, revParse } from '../git/plumbing.js'
import { GitError } from '../git/run.js'
import type { FetchStatus, Project } from '../shared/api.js'
import { githubPullHeadRef, prBaseRef, prHeadRef } from './refs.js'

const REMOTE = 'origin'

const key = (projectId: string, number: number): string => `${projectId}#${number}`

/**
 * Brings a pull request's objects into a project's repository, lazily and in
 * the background (design.md: "Fetch is lazy and non-blocking").
 *
 * `ensure` compares the namespaced refs with the oids GitHub reports and only
 * fetches when they differ, so re-opening a PR whose head moved re-fetches
 * while an unchanged PR is `ready` without touching the network. Status is
 * kept in memory per `${projectId}#${number}`; the refs themselves persist in
 * the repository.
 */
export class PrFetcher {
  private readonly statuses = new Map<string, FetchStatus>()
  /** Background fetches, by key. */
  private readonly inflight = new Map<string, Promise<FetchStatus>>()
  /** `ensure` calls still deciding whether to fetch, by key; concurrent callers share one. */
  private readonly ensuring = new Map<string, Promise<FetchStatus>>()

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
    if (this.inflight.has(k)) return Promise.resolve(this.status(project.id, refs.number))
    const pending = this.ensuring.get(k)
    if (pending) return pending
    const decision = this.decide(project, refs, k).finally(() => this.ensuring.delete(k))
    this.ensuring.set(k, decision)
    return decision
  }

  /** Resolve once no fetch is running for the PR (tests and eager callers). */
  async waitFor(projectId: string, number: number): Promise<FetchStatus> {
    const k = key(projectId, number)
    const pending = this.ensuring.get(k)
    if (pending) await pending
    const running = this.inflight.get(k)
    if (running) return running
    return this.status(projectId, number)
  }

  private async decide(project: Project, refs: PullRequestRefs, k: string): Promise<FetchStatus> {
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
  }

  private start(project: Project, refs: PullRequestRefs, k: string): FetchStatus {
    const startedAt = nowIso()
    const fetching: FetchStatus = { state: 'fetching', startedAt }
    this.statuses.set(k, fetching)
    const run = this.runFetch(project, refs, startedAt)
      .then((final) => {
        this.statuses.set(k, final)
        return final
      })
      .finally(() => this.inflight.delete(k))
    this.inflight.set(k, run)
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
