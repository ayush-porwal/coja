import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerContext } from '../context.js'
import { openDb } from '../db.js'
import { type Forge, ForgeError, type PullRequestRefs, type RepoRef } from '../forge/forge.js'
import { APP_TS_HEAD, createFixture, type Fixture } from '../git/test-fixture.js'
import { PrFetcher } from '../pr/fetcher.js'
import { addLocalProject } from '../projects/add.js'
import {
  API_ROUTES,
  type ApiError,
  type BlobResponse,
  type FetchStatus,
  type FileDiffResponse,
  type GitChangedFile,
  type Project,
} from '../shared/api.js'
import { registerGitRoutes } from './git.js'
import { onApiError } from './http.js'

let fx: Fixture
let ctx: ServerContext
let app: Hono
let project: Project
let fetcher: PrFetcher
const forgeCalls: { repo: RepoRef; number: number }[] = []

/** Only getPullRequestRefs is exercised by these routes. */
function fakeForge(f: Fixture): Forge {
  return {
    async getPullRequestRefs(repo: RepoRef, number: number): Promise<PullRequestRefs> {
      forgeCalls.push({ repo, number })
      if (number !== 1) throw new ForgeError(`PR #${number} not found`, 404)
      return {
        id: 'PR_1',
        number: 1,
        headRefOid: f.headOid,
        baseRefOid: f.mainOid,
        baseRefName: 'main',
        headRefName: 'feature',
      }
    },
  } as unknown as Forge
}

beforeAll(async () => {
  fx = await createFixture()
  ctx = { dataDir: await mkdtemp(path.join(os.tmpdir(), 'coja-data-')), db: openDb(':memory:') }
  fetcher = new PrFetcher()
  app = new Hono()
  app.onError(onApiError)
  registerGitRoutes(app, ctx, { forge: fakeForge(fx), fetcher })
  project = await addLocalProject(ctx, fx.localDir)
})

afterAll(async () => {
  ctx.db.close()
  await rm(ctx.dataDir, { recursive: true, force: true })
  await fx.cleanup()
})

const get = async <T>(url: string): Promise<{ status: number; body: T }> => {
  const res = await app.request(url)
  return { status: res.status, body: (await res.json()) as T }
}

describe('git routes', () => {
  it('reports idle before any fetch and 409s for object routes', async () => {
    expect(await get(API_ROUTES.prFetch(project.id, 1))).toEqual({
      status: 200,
      body: { state: 'idle' },
    })
    for (const url of [
      API_ROUTES.prGitFiles(project.id, 1),
      `${API_ROUTES.prDiff(project.id, 1)}?path=src/app.ts`,
      `${API_ROUTES.prBlob(project.id, 1)}?ref=head&path=src/app.ts`,
    ]) {
      const { status, body } = await get<ApiError>(url)
      expect(status, url).toBe(409)
      expect(body.code).toBe('git')
      expect(body.error).toContain('not fetched yet')
    }
  })

  it('POST fetch starts a background fetch and GET fetch polls it to ready', async () => {
    const res = await app.request(API_ROUTES.prFetch(project.id, 1), { method: 'POST' })
    expect(res.status).toBe(200)
    const started = (await res.json()) as FetchStatus
    expect(started.state).toBe('fetching')
    expect(forgeCalls).toEqual([{ repo: { owner: 'acme', repo: 'widgets' }, number: 1 }])

    await fetcher.waitFor(project.id, 1)
    const { body } = await get<FetchStatus>(API_ROUTES.prFetch(project.id, 1))
    expect(body).toMatchObject({
      state: 'ready',
      headOid: fx.headOid,
      baseOid: fx.mainOid,
      mergeBaseOid: fx.baseOid,
    })

    // Idempotent: a second POST is ready at once.
    const again = await app.request(API_ROUTES.prFetch(project.id, 1), { method: 'POST' })
    expect(((await again.json()) as FetchStatus).state).toBe('ready')
  })

  it('GET git-files lists the changed files from git', async () => {
    const { status, body } = await get<GitChangedFile[]>(API_ROUTES.prGitFiles(project.id, 1))
    expect(status).toBe(200)
    expect(body).toHaveLength(6)
    expect(body).toContainEqual({
      path: 'src/util/helpers.ts',
      previousPath: 'src/legacy/helpers.ts',
      status: 'R',
    })
    expect(body).toContainEqual({ path: 'src/remove-me.ts', status: 'D' })
  })

  it('GET diff returns one file patch, pairing renames via previousPath', async () => {
    const plain = await get<FileDiffResponse>(`${API_ROUTES.prDiff(project.id, 1)}?path=src/app.ts`)
    expect(plain.status).toBe(200)
    expect(plain.body).toMatchObject({ path: 'src/app.ts', binary: false, tooLarge: false })
    expect(plain.body.patch).toContain("+  const greeting = 'HELLO'")

    const q = new URLSearchParams({
      path: 'src/util/helpers.ts',
      previousPath: 'src/legacy/helpers.ts',
    })
    const renamed = await get<FileDiffResponse>(`${API_ROUTES.prDiff(project.id, 1)}?${q}`)
    expect(renamed.body.previousPath).toBe('src/legacy/helpers.ts')
    expect(renamed.body.patch).toContain('rename from src/legacy/helpers.ts')

    const glob = await get<FileDiffResponse>(
      `${API_ROUTES.prDiff(project.id, 1)}?${new URLSearchParams({ path: 'app/[id]/page.tsx' })}`,
    )
    expect(glob.body.patch).toContain('diff --git a/app/[id]/page.tsx b/app/[id]/page.tsx')

    const bin = await get<FileDiffResponse>(
      `${API_ROUTES.prDiff(project.id, 1)}?path=assets/logo.bin`,
    )
    expect(bin.body).toEqual({ path: 'assets/logo.bin', patch: '', binary: true, tooLarge: false })
  })

  it('GET diff validates its query', async () => {
    expect((await get<ApiError>(API_ROUTES.prDiff(project.id, 1))).status).toBe(400)
    const traversal = await get<ApiError>(`${API_ROUTES.prDiff(project.id, 1)}?path=../etc/passwd`)
    expect(traversal.status).toBe(400)
    expect(traversal.body.code).toBe('bad_request')
    expect((await get<ApiError>(`${API_ROUTES.prDiff(project.id, 1)}?path=-rf`)).status).toBe(400)
  })

  it('GET blob reads head and base (merge base) with optional ranges', async () => {
    const head = await get<BlobResponse>(
      `${API_ROUTES.prBlob(project.id, 1)}?ref=head&path=src/app.ts`,
    )
    expect(head.status).toBe(200)
    expect(head.body).toEqual({
      ref: 'head',
      oid: fx.headOid,
      path: 'src/app.ts',
      text: APP_TS_HEAD,
      lineCount: 13,
    })

    const range = await get<BlobResponse>(
      `${API_ROUTES.prBlob(project.id, 1)}?ref=head&path=src/app.ts&start=2&end=3`,
    )
    expect(range.body).toMatchObject({
      startLine: 2,
      endLine: 3,
      text: "  const greeting = 'HELLO'\n  const flag = '-weird'",
    })

    // `base` resolves to the merge base, i.e. what the diff's left side shows.
    const base = await get<BlobResponse>(
      `${API_ROUTES.prBlob(project.id, 1)}?ref=base&path=src/remove-me.ts`,
    )
    expect(base.body).toMatchObject({
      ref: 'base',
      oid: fx.baseOid,
      text: 'export const gone = true\n',
    })

    const defaultRef = await get<BlobResponse>(
      `${API_ROUTES.prBlob(project.id, 1)}?path=src/feature.ts`,
    )
    expect(defaultRef.body.ref).toBe('head')
  })

  it('GET blob 404s for missing paths and 400s for bad queries', async () => {
    const missing = await get<ApiError>(
      `${API_ROUTES.prBlob(project.id, 1)}?ref=head&path=src/remove-me.ts`,
    )
    expect(missing.status).toBe(404)
    expect(missing.body.code).toBe('not_found')
    expect(
      (await get<ApiError>(`${API_ROUTES.prBlob(project.id, 1)}?ref=nope&path=x`)).status,
    ).toBe(400)
    expect((await get<ApiError>(`${API_ROUTES.prBlob(project.id, 1)}?ref=head`)).status).toBe(400)
    expect(
      (await get<ApiError>(`${API_ROUTES.prBlob(project.id, 1)}?path=src/app.ts&start=0`)).status,
    ).toBe(400)
    expect(
      (await get<ApiError>(`${API_ROUTES.prBlob(project.id, 1)}?path=src/app.ts&start=abc`)).status,
    ).toBe(400)
  })

  it('404s for unknown projects and 400s for bad PR numbers', async () => {
    expect((await get<ApiError>(API_ROUTES.prFetch('missing', 1))).status).toBe(404)
    expect((await app.request(API_ROUTES.prFetch('missing', 1), { method: 'POST' })).status).toBe(
      404,
    )
    expect((await get<ApiError>(`/api/projects/${project.id}/prs/0/fetch`)).status).toBe(400)
    expect((await get<ApiError>(`/api/projects/${project.id}/prs/abc/fetch`)).status).toBe(400)
    expect((await get<ApiError>(`/api/projects/${project.id}/prs/-1/fetch`)).status).toBe(400)
  })

  it('maps forge failures through onApiError', async () => {
    const res = await app.request(API_ROUTES.prFetch(project.id, 2), { method: 'POST' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiError).code).toBe('github')
  })
})
