import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { ServerContext } from '../context.js'
import { openDb } from '../db.js'
import { type Forge, ForgeError } from '../forge/forge.js'
import { insertProject } from '../projects/store.js'
import { API_ROUTES, type ApiError, type PullRequestSummary } from '../shared/api.js'
import { onApiError } from './http.js'
import { registerPullRoutes } from './pulls.js'

export function fakeForge(): { [K in keyof Forge]: ReturnType<typeof vi.fn<Forge[K]>> } {
  return {
    viewer: vi.fn<Forge['viewer']>(),
    listPullRequestPage: vi.fn<Forge['listPullRequestPage']>(),
    getPullRequestRefs: vi.fn<Forge['getPullRequestRefs']>(),
    getPullRequest: vi.fn<Forge['getPullRequest']>(),
    addPendingComment: vi.fn<Forge['addPendingComment']>(),
    replyToThread: vi.fn<Forge['replyToThread']>(),
    updateComment: vi.fn<Forge['updateComment']>(),
    deleteComment: vi.fn<Forge['deleteComment']>(),
    assertCommentInPullRequest: vi.fn<Forge['assertCommentInPullRequest']>(),
    assertThreadInPullRequest: vi.fn<Forge['assertThreadInPullRequest']>(),
    setFileViewed: vi.fn<Forge['setFileViewed']>(),
    submitReview: vi.fn<Forge['submitReview']>(),
    discardPendingReview: vi.fn<Forge['discardPendingReview']>(),
  }
}

export function testContext(): ServerContext {
  return { dataDir: '/nonexistent', db: openDb(':memory:') }
}

function setup() {
  const ctx = testContext()
  const project = insertProject(ctx.db, {
    kind: 'local',
    owner: 'acme',
    repo: 'widgets',
    path: '/tmp/widgets',
  })
  const forge = fakeForge()
  const app = new Hono()
  app.onError(onApiError)
  registerPullRoutes(app, ctx, { forge })
  return { app, forge, project }
}

const SUMMARY: PullRequestSummary = {
  id: 'PR_1',
  number: 7,
  title: 'Add widgets',
  author: { login: 'alice' },
  headRefName: 'feature',
  baseRefName: 'main',
  headRefOid: 'a'.repeat(40),
  baseRefOid: 'b'.repeat(40),
  updatedAt: '2026-09-02T10:00:00Z',
  createdAt: '2026-09-01T10:00:00Z',
  isDraft: false,
  url: 'https://github.com/acme/widgets/pull/7',
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  myReviewState: 'none',
}

describe('pull request routes', () => {
  it('GET prs serves a page of open PRs (page query, default 1)', async () => {
    const { app, forge, project } = setup()
    const page = {
      items: [SUMMARY],
      page: 2,
      perPage: 100,
      total: 250,
      totalPages: 3,
    }
    forge.listPullRequestPage.mockResolvedValue(page)
    const res = await app.request(`${API_ROUTES.prs(project.id)}?page=2`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(page)
    expect(forge.listPullRequestPage).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      2,
      undefined,
    )

    // Default and malformed pages clamp to 1.
    await app.request(API_ROUTES.prs(project.id))
    expect(forge.listPullRequestPage).toHaveBeenLastCalledWith(
      { owner: 'acme', repo: 'widgets' },
      1,
      undefined,
    )
    await app.request(`${API_ROUTES.prs(project.id)}?page=banana`)
    expect(forge.listPullRequestPage).toHaveBeenLastCalledWith(
      { owner: 'acme', repo: 'widgets' },
      1,
      undefined,
    )
  })

  it('GET pr returns the detail', async () => {
    const { app, forge, project } = setup()
    const detail = {
      ...SUMMARY,
      body: '',
      bodyHTML: '',
      commits: [],
      files: [],
      threads: [],
      conversation: [],
      pendingReview: null,
      viewer: { login: 'me' },
    }
    forge.getPullRequest.mockResolvedValue(detail)
    const res = await app.request(API_ROUTES.pr(project.id, 7))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(detail)
    expect(forge.getPullRequest).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 7)
  })

  it('404s for an unknown project without calling the forge', async () => {
    const { app, forge } = setup()
    for (const url of [API_ROUTES.prs('nope'), API_ROUTES.pr('nope', 1)]) {
      const res = await app.request(url)
      expect(res.status).toBe(404)
      expect((await res.json()) as ApiError).toEqual({
        error: 'project not found',
        code: 'not_found',
      })
    }
    expect(forge.listPullRequestPage).not.toHaveBeenCalled()
    expect(forge.getPullRequest).not.toHaveBeenCalled()
  })

  it('400s for a malformed PR number', async () => {
    const { app, forge, project } = setup()
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const res = await app.request(`/api/projects/${project.id}/prs/${bad}`)
      expect(res.status).toBe(400)
      expect(((await res.json()) as ApiError).code).toBe('bad_request')
    }
    expect(forge.getPullRequest).not.toHaveBeenCalled()
  })

  it('forwards forge errors with their status and the github code', async () => {
    const { app, forge, project } = setup()
    forge.getPullRequest.mockRejectedValue(new ForgeError('Pull request #9 was not found', 404))
    const res = await app.request(API_ROUTES.pr(project.id, 9))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Pull request #9 was not found', code: 'github' })
  })
})
