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
import type { ContextChip, GitChangedFile, ReviewDetail } from './contracts.js'
import { badRequest } from './errors.js'
import { assertKnownToolParts, pruneOlderToolOutputs } from './history.js'
import { buildSystemPrompt } from './prompt.js'
import { createReviewTools, type ToolContext } from './tools.js'
import { type ChatMessage, chatMessageMetadataSchema, contextChipSchema } from './types.js'

/**
 * One chat turn: validate the conversation the browser sent, run the agent
 * loop (model ↔ read-only tools) and stream it back as a Vercel AI SDK UI
 * message stream. The host receives the complete history through onFinish,
 * including on abort, and decides how to persist it.
 */

/** Model steps per turn (each tool round trip is a step). */
export const MAX_STEPS = 12
export const MAX_OUTPUT_TOKENS = 4096

export interface ChatTurnParams {
  chat: { id: string }
  messages: unknown[]
  model: string
  languageModel: LanguageModel | (() => Promise<LanguageModel>)
  toolContext: ToolContext
  detail: ReviewDetail
  files: GitChangedFile[]
  signal: AbortSignal
  /** Called with the full history when streaming ends, including on abort. */
  onFinish(messages: ChatMessage[]): void | Promise<void>
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
  const { chat, model: modelId, toolContext, detail, files, signal } = params
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

  const model =
    typeof params.languageModel === 'function' ? await params.languageModel() : params.languageModel

  // The model gets older tool results elided; `messages` itself (persisted below) stays whole.
  const modelMessages = await convertToModelMessages<ChatMessage>(pruneOlderToolOutputs(messages), {
    tools,
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) =>
      part.type === 'data-chip'
        ? { type: 'text', text: chipToText(contextChipSchema.parse(part.data)) }
        : undefined,
  })

  const createdAt = new Date().toISOString()
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
      onEnd: ({ messages: all }) => params.onFinish(all),
    }),
  })
}
