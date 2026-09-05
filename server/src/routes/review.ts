import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import type { Forge } from '../forge/forge.js'
import type {
  AddCommentResponse,
  ReplyResponse,
  ReviewComment,
  SetViewedResponse,
  SubmitReviewResponse,
} from '../shared/api.js'
import { badRequest } from './http.js'
import { PR_ROUTE, resolvePr } from './pulls.js'

/**
 * Review sync routes. Each handler is one explicit human action in the UI and
 * goes straight to GitHub through the Forge — GitHub is the source of truth,
 * nothing is stored locally. These are the only callers of the mutating Forge
 * methods; the AI layer never gets a Forge ("the AI drafts, the human sends").
 */

const side = z.enum(['LEFT', 'RIGHT'])
const nonBlank = (what: string) =>
  z.string().refine((s) => s.trim().length > 0, { error: `${what} must not be blank` })

const addCommentSchema = z
  .object({
    path: z.string().min(1, { error: 'path is required' }),
    body: nonBlank('body'),
    line: z.number().int().min(1),
    side,
    startLine: z.number().int().min(1).optional(),
    startSide: side.optional(),
  })
  .refine(
    // Line numbers are only comparable within one side of the diff.
    (v) => v.startLine === undefined || (v.startSide ?? v.side) !== v.side || v.startLine <= v.line,
    { error: 'startLine must not be greater than line', path: ['startLine'] },
  )

const bodySchema = z.object({ body: nonBlank('body') })

const setViewedSchema = z.object({
  path: z.string().min(1, { error: 'path is required' }),
  viewed: z.boolean(),
})

const submitReviewSchema = z.object({
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string().default(''),
})

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw badRequest('request body must be JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
      .join('; ')
    throw badRequest(`invalid request: ${issues}`)
  }
  return result.data
}

function requireParam(c: Context, name: string): string {
  const value = c.req.param(name)
  if (!value) throw badRequest(`missing ${name}`)
  return value
}

export function registerReviewRoutes(app: Hono, ctx: ServerContext, deps: { forge: Forge }): void {
  const { forge } = deps

  // Line/range comment → the viewer's pending review (created when missing).
  app.post(`${PR_ROUTE}/comments`, async (c) => {
    const { repo, number } = resolvePr(ctx, c)
    const input = await parseBody(c, addCommentSchema)
    const refs = await forge.getPullRequestRefs(repo, number)
    const res: AddCommentResponse = await forge.addPendingComment(repo, refs, input)
    return c.json(res, 201)
  })

  app.patch(`${PR_ROUTE}/comments/:commentId`, async (c) => {
    resolvePr(ctx, c)
    const commentId = requireParam(c, 'commentId')
    const { body } = await parseBody(c, bodySchema)
    const comment: ReviewComment = await forge.updateComment(commentId, body)
    return c.json(comment)
  })

  app.delete(`${PR_ROUTE}/comments/:commentId`, async (c) => {
    resolvePr(ctx, c)
    await forge.deleteComment(requireParam(c, 'commentId'))
    return c.json({ ok: true as const })
  })

  // Replies publish immediately (decisions.md) unless the viewer has a pending review open, in
  // which case GitHub attaches the reply to it; the response's comment.isPending tells the UI.
  app.post(`${PR_ROUTE}/threads/:threadId/replies`, async (c) => {
    resolvePr(ctx, c)
    const threadId = requireParam(c, 'threadId')
    const { body } = await parseBody(c, bodySchema)
    const res: ReplyResponse = await forge.replyToThread(threadId, body)
    return c.json(res, 201)
  })

  app.post(`${PR_ROUTE}/viewed`, async (c) => {
    const { repo, number } = resolvePr(ctx, c)
    const { path, viewed } = await parseBody(c, setViewedSchema)
    const refs = await forge.getPullRequestRefs(repo, number)
    const viewedState = await forge.setFileViewed(refs.id, path, viewed)
    const res: SetViewedResponse = { path, viewedState }
    return c.json(res)
  })

  app.post(`${PR_ROUTE}/review`, async (c) => {
    const { repo, number } = resolvePr(ctx, c)
    const input = await parseBody(c, submitReviewSchema)
    const refs = await forge.getPullRequestRefs(repo, number)
    const res: SubmitReviewResponse = await forge.submitReview(repo, refs, input)
    return c.json(res)
  })

  app.delete(`${PR_ROUTE}/review`, async (c) => {
    const { repo, number } = resolvePr(ctx, c)
    await forge.discardPendingReview(repo, number)
    return c.json({ ok: true as const })
  })
}
