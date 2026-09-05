import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { PullRequestRefs } from '../forge/forge.js'
import { insertProject } from '../projects/store.js'
import { API_ROUTES, type ApiError, type ReviewComment, type ReviewThread } from '../shared/api.js'
import { HttpError, onApiError } from './http.js'
import { fakeForge, testContext } from './pulls.test.js'
import { registerReviewRoutes } from './review.js'

const REFS: PullRequestRefs = {
  id: 'PR_1',
  number: 7,
  headRefOid: 'a'.repeat(40),
  baseRefOid: 'b'.repeat(40),
  baseRefName: 'main',
  headRefName: 'feature',
}

const COMMENT: ReviewComment = {
  id: 'PRRC_1',
  body: 'nit',
  bodyHTML: '<p>nit</p>',
  author: { login: 'me' },
  createdAt: '2026-09-02T10:00:00Z',
  reviewId: 'PRR_1',
  reviewState: 'PENDING',
  isPending: true,
  isMine: true,
}

const THREAD: ReviewThread = {
  id: 'PRRT_1',
  path: 'src/a.ts',
  line: 5,
  startLine: 5,
  side: 'RIGHT',
  startSide: null,
  originalLine: 5,
  isResolved: false,
  isOutdated: false,
  comments: [COMMENT],
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
  forge.getPullRequestRefs.mockResolvedValue(REFS)
  const app = new Hono()
  app.onError(onApiError)
  registerReviewRoutes(app, ctx, { forge })
  const send = (method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { app, forge, project, send, repo: { owner: 'acme', repo: 'widgets' } }
}

describe('review routes', () => {
  it('POST comments validates, resolves refs and adds to the pending review', async () => {
    const { forge, project, send, repo } = setup()
    forge.addPendingComment.mockResolvedValue({
      thread: THREAD,
      pendingReview: { id: 'PRR_1', commentCount: 1 },
    })
    const input = { path: 'src/a.ts', body: 'nit', line: 5, side: 'RIGHT' }
    const res = await send('POST', API_ROUTES.prComments(project.id, 7), input)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      thread: THREAD,
      pendingReview: { id: 'PRR_1', commentCount: 1 },
    })
    expect(forge.getPullRequestRefs).toHaveBeenCalledWith(repo, 7)
    expect(forge.addPendingComment).toHaveBeenCalledWith(repo, REFS, input)
  })

  it('POST comments rejects bad input with 400 before touching the forge', async () => {
    const { forge, project, send } = setup()
    const url = API_ROUTES.prComments(project.id, 7)
    const cases: [unknown, string][] = [
      [{ path: '', body: 'x', line: 1, side: 'RIGHT' }, 'path'],
      [{ path: 'a', body: '   ', line: 1, side: 'RIGHT' }, 'body'],
      [{ path: 'a', body: 'x', line: 0, side: 'RIGHT' }, 'line'],
      [{ path: 'a', body: 'x', line: 1.5, side: 'RIGHT' }, 'line'],
      [{ path: 'a', body: 'x', line: 1, side: 'MIDDLE' }, 'side'],
      [{ path: 'a', body: 'x', line: 3, side: 'RIGHT', startLine: 7 }, 'startLine'],
      ['not json', 'JSON'],
    ]
    for (const [body, needle] of cases) {
      const res = await send('POST', url, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      const err = (await res.json()) as ApiError
      expect(err.code).toBe('bad_request')
      expect(err.error).toContain(needle)
    }
    expect(forge.getPullRequestRefs).not.toHaveBeenCalled()
    expect(forge.addPendingComment).not.toHaveBeenCalled()
  })

  it('POST comments allows a range whose start is on the other side', async () => {
    const { forge, project, send } = setup()
    forge.addPendingComment.mockResolvedValue({
      thread: THREAD,
      pendingReview: { id: 'PRR_1', commentCount: 1 },
    })
    const res = await send('POST', API_ROUTES.prComments(project.id, 7), {
      path: 'a',
      body: 'x',
      line: 3,
      side: 'RIGHT',
      startLine: 7,
      startSide: 'LEFT',
    })
    expect(res.status).toBe(201)
  })

  it('PATCH / DELETE comment, after tying the id to the route’s PR', async () => {
    const { forge, project, send, repo } = setup()
    forge.updateComment.mockResolvedValue({ ...COMMENT, body: 'edited' })
    const url = API_ROUTES.prComment(project.id, 7, 'PRRC_1')

    const patched = await send('PATCH', url, { body: 'edited' })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ id: 'PRRC_1', body: 'edited' })
    expect(forge.assertCommentInPullRequest).toHaveBeenCalledWith('PRRC_1', repo, 7)
    expect(forge.updateComment).toHaveBeenCalledWith('PRRC_1', 'edited')
    const [checked] = forge.assertCommentInPullRequest.mock.invocationCallOrder
    const [updated] = forge.updateComment.mock.invocationCallOrder
    expect(checked).toBeLessThan(updated as number)

    // Junk is rejected before GitHub is asked anything.
    const blank = await send('PATCH', url, { body: '' })
    expect(blank.status).toBe(400)
    expect(forge.assertCommentInPullRequest).toHaveBeenCalledTimes(1)

    const deleted = await send('DELETE', url)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ ok: true })
    expect(forge.assertCommentInPullRequest).toHaveBeenLastCalledWith('PRRC_1', repo, 7)
    expect(forge.deleteComment).toHaveBeenCalledWith('PRRC_1')
  })

  it('refuses comment and thread ids that belong to another pull request', async () => {
    const { forge, project, send } = setup()
    forge.assertCommentInPullRequest.mockRejectedValue(
      new HttpError(404, 'comment not found in this pull request', 'not_found'),
    )
    forge.assertThreadInPullRequest.mockRejectedValue(
      new HttpError(404, 'thread not found in this pull request', 'not_found'),
    )
    const comment = API_ROUTES.prComment(project.id, 7, 'PRRC_other')
    const replies = API_ROUTES.prThreadReplies(project.id, 7, 'PRRT_other')

    const patched = await send('PATCH', comment, { body: 'edited' })
    expect(patched.status).toBe(404)
    expect(await patched.json()).toEqual({
      error: 'comment not found in this pull request',
      code: 'not_found',
    })
    expect((await send('DELETE', comment)).status).toBe(404)
    const replied = await send('POST', replies, { body: 'thanks' })
    expect(replied.status).toBe(404)
    expect(((await replied.json()) as ApiError).error).toBe('thread not found in this pull request')

    expect(forge.updateComment).not.toHaveBeenCalled()
    expect(forge.deleteComment).not.toHaveBeenCalled()
    expect(forge.replyToThread).not.toHaveBeenCalled()
  })

  it('decodes URL-encoded ids', async () => {
    const { forge, project, send } = setup()
    forge.deleteComment.mockResolvedValue(undefined)
    const legacyId = 'MDI0OlB1bGxSZXF1ZXN0UmV2aWV3Q29tbWVudDE='
    const res = await send('DELETE', API_ROUTES.prComment(project.id, 7, legacyId))
    expect(res.status).toBe(200)
    expect(forge.deleteComment).toHaveBeenCalledWith(legacyId)
  })

  it('POST thread replies, after tying the thread to the route’s PR', async () => {
    const { forge, project, send, repo } = setup()
    forge.replyToThread.mockResolvedValue({
      comment: { ...COMMENT, isPending: false },
      threadId: 'PRRT_1',
    })
    const res = await send('POST', API_ROUTES.prThreadReplies(project.id, 7, 'PRRT_1'), {
      body: 'thanks',
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ threadId: 'PRRT_1', comment: { id: 'PRRC_1' } })
    expect(forge.assertThreadInPullRequest).toHaveBeenCalledWith('PRRT_1', repo, 7)
    expect(forge.replyToThread).toHaveBeenCalledWith('PRRT_1', 'thanks')
  })

  it('POST viewed uses the PR node id from the refs', async () => {
    const { forge, project, send, repo } = setup()
    forge.setFileViewed.mockResolvedValue('VIEWED')
    const res = await send('POST', API_ROUTES.prViewed(project.id, 7), {
      path: 'src/a.ts',
      viewed: true,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'src/a.ts', viewedState: 'VIEWED' })
    expect(forge.getPullRequestRefs).toHaveBeenCalledWith(repo, 7)
    expect(forge.setFileViewed).toHaveBeenCalledWith('PR_1', 'src/a.ts', true)

    const bad = await send('POST', API_ROUTES.prViewed(project.id, 7), {
      path: 'src/a.ts',
      viewed: 'yes',
    })
    expect(bad.status).toBe(400)
  })

  it('POST review submits; DELETE review discards', async () => {
    const { forge, project, send, repo } = setup()
    forge.submitReview.mockResolvedValue({ reviewId: 'PRR_1', state: 'APPROVED', url: 'u' })
    const url = API_ROUTES.prReview(project.id, 7)

    const submitted = await send('POST', url, { event: 'APPROVE', body: 'LGTM' })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toEqual({ reviewId: 'PRR_1', state: 'APPROVED', url: 'u' })
    expect(forge.submitReview).toHaveBeenCalledWith(repo, REFS, { event: 'APPROVE', body: 'LGTM' })

    // body is optional on the wire; event must be one of the three.
    await send('POST', url, { event: 'COMMENT' })
    expect(forge.submitReview).toHaveBeenLastCalledWith(repo, REFS, { event: 'COMMENT', body: '' })
    expect((await send('POST', url, { event: 'DISMISS', body: '' })).status).toBe(400)

    const discarded = await send('DELETE', url)
    expect(discarded.status).toBe(200)
    expect(await discarded.json()).toEqual({ ok: true })
    expect(forge.discardPendingReview).toHaveBeenCalledWith(repo, 7)
  })

  it('surfaces the forge\'s "nothing to say" 400 as bad_request', async () => {
    const { forge, project, send } = setup()
    forge.submitReview.mockRejectedValue(
      new HttpError(400, 'Write a summary or add at least one comment first.', 'bad_request'),
    )
    const res = await send('POST', API_ROUTES.prReview(project.id, 7), {
      event: 'COMMENT',
      body: '',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Write a summary or add at least one comment first.',
      code: 'bad_request',
    })
  })

  it('404s every route for an unknown project', async () => {
    const { forge, send } = setup()
    const p = 'nope'
    const attempts: [string, string, unknown?][] = [
      ['POST', API_ROUTES.prComments(p, 1), { path: 'a', body: 'b', line: 1, side: 'RIGHT' }],
      ['PATCH', API_ROUTES.prComment(p, 1, 'c'), { body: 'b' }],
      ['DELETE', API_ROUTES.prComment(p, 1, 'c')],
      ['POST', API_ROUTES.prThreadReplies(p, 1, 't'), { body: 'b' }],
      ['POST', API_ROUTES.prViewed(p, 1), { path: 'a', viewed: true }],
      ['POST', API_ROUTES.prReview(p, 1), { event: 'APPROVE', body: '' }],
      ['DELETE', API_ROUTES.prReview(p, 1)],
    ]
    for (const [method, url, body] of attempts) {
      const res = await send(method, url, body)
      expect(res.status, `${method} ${url}`).toBe(404)
    }
    expect(forge.getPullRequestRefs).not.toHaveBeenCalled()
  })
})
