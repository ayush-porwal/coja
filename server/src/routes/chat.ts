import type { LanguageModel } from 'ai'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { handleChatTurn } from '../ai/chat-handler.js'
import { createChat, deleteChat, getChat, listChats } from '../ai/chats.js'
import { buildSystemPrompt } from '../ai/prompt.js'
import {
  type CustomProviderSource,
  defaultModelId,
  parseModelId,
  type SubscriptionProvider,
} from '../ai/providers.js'
import { describeTools } from '../ai/tools.js'
import type { ServerContext } from '../context.js'
import { diffNameStatus } from '../git/plumbing.js'
import type { PrFetcher } from '../pr/fetcher.js'
import type { SecretStore } from '../secrets/store.js'
import type {
  AiContextResponse,
  Chat,
  ChatWithMessages,
  Project,
  PullRequestDetail,
} from '../shared/api.js'
import { badRequest, HttpError, notFound } from './http.js'
import { PR_ROUTE, resolvePr } from './pulls.js'

/**
 * AI chat routes (API_ROUTES.prChats / prChat / prChatMessages / prAiContext).
 *
 * Deliberate shape: this module gets a read-only `readPullRequest` function,
 * never a Forge, so nothing reachable from the AI layer can post to GitHub —
 * "the AI drafts, the human sends". Routes that read PR code (a chat turn,
 * the ai-context preview) answer 409 until the PR's objects are fetched, like
 * the git routes; chat bookkeeping (list/create/get/delete) needs no objects.
 */

export const CHATS_ROUTE = `${PR_ROUTE}/chats`
export const CHAT_ROUTE = `${CHATS_ROUTE}/:chatId`
export const CHAT_MESSAGES_ROUTE = `${CHAT_ROUTE}/messages`
export const AI_CONTEXT_ROUTE = `${PR_ROUTE}/ai-context`

export interface ChatRouteDeps {
  secrets: SecretStore
  fetcher: PrFetcher
  /** Read-only PR detail (title, body, files with stats) — the Forge's `getPullRequest`, and only that. */
  readPullRequest: (project: Project, number: number) => Promise<PullRequestDetail>
  /** The connected ChatGPT subscription, when the user signed in. */
  subscription?: SubscriptionProvider
  /** Custom provider lookup (Setup's added endpoints), for model validation + resolution. */
  customProviders?: CustomProviderSource
  /** Test seam: swap the provider lookup for a mock model. */
  resolveModel?: (id: string, secrets: SecretStore) => Promise<LanguageModel>
}

const newChatSchema = z.object({ model: z.string().min(1).optional() })

/**
 * The browser re-sends the whole conversation every turn, so one request is
 * bounded here (bytes, messages); what of it reaches the model is bounded in
 * ai/history.ts.
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024
export const MAX_MESSAGES = 400

const chatRequestSchema = z.object({
  messages: z
    .array(z.unknown())
    .max(
      MAX_MESSAGES,
      `a conversation may hold at most ${MAX_MESSAGES} messages; start a new chat`,
    ),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).max(32).optional(),
})

export function registerChatRoutes(app: Hono, ctx: ServerContext, deps: ChatRouteDeps): void {
  const { secrets, fetcher, readPullRequest } = deps

  /** Head and merge base once the PR's objects are in the repository; 409 (`code: 'git'`) before. */
  const requireReady = (project: Project, number: number) => {
    const status = fetcher.status(project.id, number)
    if (status.state === 'ready' && status.headOid && status.mergeBaseOid) {
      return { headOid: status.headOid, mergeBaseOid: status.mergeBaseOid }
    }
    throw new HttpError(409, 'PR objects are still being fetched', 'git')
  }

  /** The PR detail and its changed files from git — the AI's standing context. */
  const loadPr = async (project: Project, number: number) => {
    const { headOid, mergeBaseOid } = requireReady(project, number)
    const [detail, files] = await Promise.all([
      readPullRequest(project, number),
      diffNameStatus(project.path, mergeBaseOid, headOid),
    ])
    return { headOid, mergeBaseOid, detail, files }
  }

  /** The chat named by `:chatId`, which must belong to this project and PR. */
  const loadChat = (c: Context, project: Project, number: number) => {
    const id = c.req.param('chatId') ?? ''
    const found = id ? getChat(ctx.db, id) : undefined
    if (!found || found.chat.projectId !== project.id || found.chat.prNumber !== number) {
      throw notFound('chat')
    }
    return found
  }

  app.get(CHATS_ROUTE, (c) => {
    const { project, number } = resolvePr(ctx, c)
    return c.json<Chat[]>(listChats(ctx.db, project.id, number))
  })

  app.post(CHATS_ROUTE, async (c) => {
    const { project, number } = resolvePr(ctx, c)
    const body = parse(newChatSchema, await readJsonBody(c))
    const model = body.model ?? (await defaultModelId(deps.subscription))
    if (!model) throw new HttpError(400, 'No AI provider configured', 'provider')
    parseModelId(model, deps.customProviders)
    return c.json<Chat>(createChat(ctx.db, { projectId: project.id, prNumber: number, model }), 201)
  })

  app.get(CHAT_ROUTE, (c) => {
    const { project, number } = resolvePr(ctx, c)
    return c.json<ChatWithMessages>(loadChat(c, project, number))
  })

  app.delete(CHAT_ROUTE, (c) => {
    const { project, number } = resolvePr(ctx, c)
    const { chat } = loadChat(c, project, number)
    deleteChat(ctx.db, chat.id)
    return c.json({ ok: true as const })
  })

  app.post(CHAT_MESSAGES_ROUTE, async (c) => {
    const { project, number } = resolvePr(ctx, c)
    const { chat } = loadChat(c, project, number)
    const body = parse(chatRequestSchema, await readJsonBody(c))
    // An unknown model is a 400 here, before the fetch-state check and whichever model resolver runs.
    const { provider, modelId } = parseModelId(body.model)
    // A requested reasoning effort must be one the backend catalog offers for
    // this model (subscription path); other providers do not take one from coja.
    if (body.reasoningEffort && provider === 'chatgpt') {
      const ok =
        deps.subscription &&
        (await deps.subscription
          .supportsReasoningEffort(modelId, body.reasoningEffort)
          .catch(() => false))
      if (!ok) {
        throw new HttpError(
          400,
          `reasoning effort "${body.reasoningEffort}" is not offered for ${modelId}; pick one from the model's list`,
          'provider',
        )
      }
    }
    const { headOid, mergeBaseOid, detail, files } = await loadPr(project, number)
    return handleChatTurn({
      db: ctx.db,
      secrets,
      chat,
      messages: body.messages,
      model: body.model,
      toolContext: {
        repo: project.path,
        headOid,
        baseOid: mergeBaseOid,
        files,
      },
      detail,
      files,
      signal: c.req.raw.signal,
      customProviders: deps.customProviders,
      ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
      ...(deps.subscription ? { subscription: deps.subscription } : {}),
      ...(deps.resolveModel ? { languageModel: await deps.resolveModel(body.model, secrets) } : {}),
    })
  })

  app.get(AI_CONTEXT_ROUTE, async (c) => {
    const { project, number } = resolvePr(ctx, c)
    const { detail, files } = await loadPr(project, number)
    const response: AiContextResponse = {
      system: buildSystemPrompt({ detail, files }),
      tools: describeTools(),
    }
    return c.json(response)
  })
}

/** The JSON body, or `{}` when there is none (all fields of NewChatRequest are optional). 413 past MAX_BODY_BYTES. */
async function readJsonBody(c: Context): Promise<unknown> {
  const text = await readBodyText(c, MAX_BODY_BYTES)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw badRequest('request body must be JSON')
  }
}

/**
 * The request body as text, refusing more than `maxBytes` with a 413: up front
 * when Content-Length says so, otherwise as soon as the stream exceeds the cap,
 * so an oversized body is never buffered whole (let alone parsed).
 */
async function readBodyText(c: Context, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new HttpError(
      413,
      `request body too large: at most ${maxBytes / (1024 * 1024)} MB per chat request`,
      'bad_request',
    )
  const declared = Number(c.req.header('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  const body = c.req.raw.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues = result.error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ')
  throw badRequest(`invalid request: ${issues}`)
}
