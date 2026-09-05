import { access } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PullRequestRefs } from '../forge/forge.js'
import { revParse } from '../git/plumbing.js'
import { runGit } from '../git/run.js'
import { createFixture, type Fixture } from '../git/test-fixture.js'
import type { Project } from '../shared/api.js'
import { PrFetcher } from './fetcher.js'
import { prBaseRef, prHeadRef } from './refs.js'

let fx: Fixture
let project: Project

const refsFor = (f: Fixture, overrides: Partial<PullRequestRefs> = {}): PullRequestRefs => ({
  id: 'PR_1',
  number: 1,
  headRefOid: f.headOid,
  baseRefOid: f.mainOid,
  baseRefName: 'main',
  headRefName: 'feature',
  ...overrides,
})

beforeAll(async () => {
  fx = await createFixture()
  project = {
    id: 'p1',
    kind: 'local',
    owner: 'acme',
    repo: 'widgets',
    path: fx.localDir,
    createdAt: new Date().toISOString(),
  }
})

afterAll(() => fx.cleanup())

describe('PrFetcher', () => {
  it('is idle for unknown PRs', () => {
    expect(new PrFetcher().status('nope', 7)).toEqual({ state: 'idle' })
  })

  it('fetches in the background and becomes ready with the merge base', async () => {
    const fetcher = new PrFetcher()
    const statusBefore = await fx.git(fx.localDir, ['status', '--porcelain', '--branch'])
    const branchesBefore = await fx.git(fx.localDir, ['for-each-ref', 'refs/heads', 'refs/remotes'])

    const first = await fetcher.ensure(project, refsFor(fx))
    expect(first.state).toBe('fetching')
    expect(first.startedAt).toBeTruthy()
    expect(fetcher.status('p1', 1).state).toBe('fetching')

    const ready = await fetcher.waitFor('p1', 1)
    expect(ready).toMatchObject({
      state: 'ready',
      headOid: fx.headOid,
      baseOid: fx.mainOid,
      mergeBaseOid: fx.baseOid,
      startedAt: first.startedAt,
    })
    expect(ready.finishedAt).toBeTruthy()
    expect(fetcher.status('p1', 1)).toEqual(ready)

    expect(await revParse(fx.localDir, prHeadRef(1))).toBe(fx.headOid)
    expect(await revParse(fx.localDir, prBaseRef(1))).toBe(fx.mainOid)

    // The user's checkout, branches and FETCH_HEAD are untouched.
    expect(await fx.git(fx.localDir, ['status', '--porcelain', '--branch'])).toBe(statusBefore)
    expect(await fx.git(fx.localDir, ['for-each-ref', 'refs/heads', 'refs/remotes'])).toBe(
      branchesBefore,
    )
    await expect(access(path.join(fx.localDir, '.git', 'FETCH_HEAD'))).rejects.toThrow()
  })

  it('is a no-op when the refs already match, even for a fresh fetcher', async () => {
    const fetcher = new PrFetcher()
    const status = await fetcher.ensure(project, refsFor(fx))
    expect(status).toMatchObject({
      state: 'ready',
      headOid: fx.headOid,
      baseOid: fx.mainOid,
      mergeBaseOid: fx.baseOid,
    })
    expect(status.startedAt).toBeUndefined()
    // A second call returns the cached status object as-is.
    expect(await fetcher.ensure(project, refsFor(fx))).toBe(status)
    expect(await fetcher.waitFor('p1', 1)).toBe(status)
  })

  it('shares one in-flight fetch between concurrent callers', async () => {
    const fetcher = new PrFetcher()
    const moved = refsFor(fx, { baseRefOid: fx.baseOid }) // different base → must fetch
    const [a, b] = await Promise.all([
      fetcher.ensure(project, moved),
      fetcher.ensure(project, moved),
    ])
    expect(a.state).toBe('fetching')
    expect(b.state).toBe('fetching')
    const ready = await fetcher.waitFor('p1', 1)
    expect(ready).toMatchObject({ state: 'ready', baseOid: fx.baseOid, mergeBaseOid: fx.baseOid })
  })

  it('re-fetches when the head moved', async () => {
    const fetcher = new PrFetcher()
    expect((await fetcher.ensure(project, refsFor(fx))).state).toBe('fetching')
    expect((await fetcher.waitFor('p1', 1)).state).toBe('ready')

    const newHead = await fx.advancePrHead()
    expect(newHead).not.toBe(fx.headOid)
    const again = await fetcher.ensure(project, refsFor(fx, { headRefOid: newHead }))
    expect(again.state).toBe('fetching')
    const ready = await fetcher.waitFor('p1', 1)
    expect(ready).toMatchObject({ state: 'ready', headOid: newHead, mergeBaseOid: fx.baseOid })
    expect(await revParse(fx.localDir, prHeadRef(1))).toBe(newHead)
    fx.headOid = newHead
  })

  it('falls back to the base branch tip when the base oid cannot be fetched', async () => {
    const fetcher = new PrFetcher()
    const bogusBase = '0123456789abcdef0123456789abcdef01234567'
    expect((await fetcher.ensure(project, refsFor(fx, { baseRefOid: bogusBase }))).state).toBe(
      'fetching',
    )
    const ready = await fetcher.waitFor('p1', 1)
    expect(ready).toMatchObject({ state: 'ready', headOid: fx.headOid, baseOid: fx.mainOid })
  })

  it('reports git errors without throwing', async () => {
    const fetcher = new PrFetcher()
    const broken: Project = { ...project, id: 'p2', path: fx.workDir }
    await fx.git(fx.workDir, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')])
    expect((await fetcher.ensure(broken, refsFor(fx))).state).toBe('fetching')
    const failed = await fetcher.waitFor('p2', 1)
    expect(failed.state).toBe('error')
    expect(failed.error).toMatch(/does not appear to be a git repository|missing\.git/)
    expect(failed.startedAt).toBeTruthy()
    expect(failed.finishedAt).toBeTruthy()
    await fx.git(fx.workDir, ['remote', 'set-url', 'origin', fx.originDir])
  })

  it('keys status by project and PR number', async () => {
    const fetcher = new PrFetcher()
    expect(fetcher.status('p1', 2)).toEqual({ state: 'idle' })
    expect(fetcher.status('other', 1)).toEqual({ state: 'idle' })
  })

  /** A fresh app-managed bare clone as its own project, so these scenarios start from no PR refs. */
  const bareProject = async (name: string): Promise<Project> => {
    const dir = path.join(fx.root, `${name}.git`)
    await fx.cloneBareLocal(dir)
    return { ...project, id: name, path: dir }
  }

  it('decides again with the newest refs when they change while a fetch is in flight', async () => {
    const p = await bareProject('inflight')
    const fetcher = new PrFetcher()
    expect((await fetcher.ensure(p, refsFor(fx))).state).toBe('fetching')
    // GitHub now reports another base oid while that fetch is still running.
    const moved = refsFor(fx, { baseRefOid: fx.baseOid })
    expect((await fetcher.ensure(p, moved)).state).toBe('fetching')

    const ready = await fetcher.waitFor(p.id, 1)
    expect(ready).toMatchObject({
      state: 'ready',
      headOid: fx.headOid,
      baseOid: fx.baseOid,
      mergeBaseOid: fx.baseOid,
    })
    expect(await revParse(p.path, prBaseRef(1))).toBe(fx.baseOid)
  })

  it('decides again when the refs change while the first decision is still pending', async () => {
    const p = await bareProject('deciding')
    const fetcher = new PrFetcher()
    const [a, b] = await Promise.all([
      fetcher.ensure(p, refsFor(fx)),
      fetcher.ensure(p, refsFor(fx, { baseRefOid: fx.baseOid })),
    ])
    expect(a.state).toBe('fetching')
    expect(b.state).toBe('fetching')
    expect(await fetcher.waitFor(p.id, 1)).toMatchObject({ state: 'ready', baseOid: fx.baseOid })
    expect(await revParse(p.path, prBaseRef(1))).toBe(fx.baseOid)
  })

  it('records an error status instead of rejecting when the refs have no merge base', async () => {
    const p = await bareProject('orphan')
    // Namespaced refs already in place, pointing at commits without a common ancestor, so
    // `ensure` skips the fetch and goes straight to `merge-base`.
    const emptyTree = (await runGit(p.path, ['mktree'], { input: '' })).stdout.toString().trim()
    const orphan = await fx.git(p.path, ['commit-tree', emptyTree, '-m', 'unrelated root'])
    await fx.git(p.path, ['update-ref', prHeadRef(1), fx.mainOid])
    await fx.git(p.path, ['update-ref', prBaseRef(1), orphan])

    const fetcher = new PrFetcher()
    const status = await fetcher.ensure(
      p,
      refsFor(fx, { headRefOid: fx.mainOid, baseRefOid: orphan }),
    )
    expect(status.state).toBe('error')
    expect(status.error).toContain('no common ancestor')
    expect(status.finishedAt).toBeTruthy()
    expect(fetcher.status(p.id, 1)).toEqual(status)
    await expect(fetcher.waitFor(p.id, 1)).resolves.toEqual(status)
  })
})

describe('refs', () => {
  it('namespaces fetched refs under refs/coja', () => {
    expect(prHeadRef(12)).toBe('refs/coja/pull/12/head')
    expect(prBaseRef(12)).toBe('refs/coja/pull/12/base')
    expect(() => prHeadRef(0)).toThrow(RangeError)
    expect(() => prBaseRef(1.5)).toThrow(RangeError)
  })
})
