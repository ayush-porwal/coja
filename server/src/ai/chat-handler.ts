import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModel,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai'
import { type Db, nowIso } from '../db.js'
import { badRequest } from '../routes/http.js'
import type { SecretStore } from '../secrets/store.js'
import type { Chat, ContextChip, GitChangedFile, PullRequestDetail } from '../shared/api.js'
import { saveMessages } from './chats.js'
import { assertKnownToolParts, pruneOlderToolOutputs } from './history.js'
import { buildSystemPrompt } from './prompt.js'
import { resolveLanguageModel } from './providers.js'
import { createReviewTools, type ToolContext } from './tools.js'
import { type ChatMessage, chatMessageMetadataSchema, contextChipSchema } from './types.js'

/**
 * One chat turn: validate the conversation the browser sent, run the agent
 * loop (model ↔ read-only tools) and stream it back as a Vercel AI SDK UI
 * message stream, persisting the whole conversation when the stream ends —
 * also on abort, so a stopped answer survives a reload.
 *
 * The model's output goes to exactly two places: this response and the
 * `chats` table. Nothing here can reach GitHub.
 */

/** Model steps per turn (each tool round trip is a step). */
export const MAX_STEPS = 12
export const MAX_OUTPUT_TOKENS = 4096

export interface ChatTurnParams {
  db: Db
  secrets: SecretStore
  chat: Chat
  /** The full conversation as sent by the client (`ChatRequest.messages`), not yet validated. */
  messages: unknown[]
  /** `<provider>:<model id>` to answer with. */
  model: string
  toolContext: ToolContext
  detail: PullRequestDetail
  files: GitChangedFile[]
  /** Aborts the provider call and tool execution when the client disconnects. */
  signal: AbortSignal
  /** Test seam: use this model instead of resolving `model` through the secret store. */
  languageModel?: LanguageModel
}

/**
 * The exact text a context chip becomes for the model. The UI renders the
 * same thing when a chip is expanded, so nothing reaches the model that the
 * user cannot see.
 */
export function chipToText(chip: ContextChip): string {
  const fence = chip.text.includes('```') ? '````' : '```'
  return [
    `[Attached selection — ${chip.path}:${chip.startLine}-${chip.endLine} @ ${chip.ref} (${chip.side} side of the diff)]`,
    fence,
    chip.text,
    fence,
  ].join('\n')
}

export async function handleChatTurn(params: ChatTurnParams): Promise<Response> {
  const { db, chat, model: modelId, toolContext, detail, files, signal } = params
  const tools = createReviewTools(toolContext)

  // Before validation, which would quietly recast unknown tool parts as dynamic ones (history.ts).
  assertKnownToolParts(params.messages)
  let messages: ChatMessage[]
  try {
    messages = await validateUIMessages<ChatMessage>({
      messages: params.messages,
      metadataSchema: chatMessageMetadataSchema,
      dataSchemas: { chip: contextChipSchema },
      tools,
    })
  } catch (err) {
    throw badRequest(`invalid messages: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (messages.length === 0) throw badRequest('messages must not be empty')
  if (messages[messages.length - 1]?.role !== 'user') {
    throw badRequest('the last message must be a user message')
  }

  const model = params.languageModel ?? (await resolveLanguageModel(modelId, params.secrets))

  // The model gets older tool results elided; `messages` itself (persisted below) stays whole.
  const modelMessages = await convertToModelMessages<ChatMessage>(pruneOlderToolOutputs(messages), {
    tools,
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) =>
      part.type === 'data-chip'
        ? { type: 'text', text: chipToText(contextChipSchema.parse(part.data)) }
        : undefined,
  })

  const createdAt = nowIso()
  const result = streamText({
    model,
    instructions: buildSystemPrompt({ detail, files }),
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: signal,
    // Provider and stream errors are not thrown; they reach the client as an `error` chunk.
    onError: ({ error }) => console.error(`coja: model error in chat ${chat.id}:`, error),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
      messageMetadata: ({ part }) =>
        part.type === 'start' ? { model: modelId, createdAt } : undefined,
      // The default hides details behind "An error occurred."; the reviewer should see the real reason.
      onError: (error) => (error instanceof Error ? error.message : String(error)),
      onEnd: ({ messages: all }) => {
        saveMessages(db, chat.id, all, { model: modelId })
      },
    }),
  })
}
