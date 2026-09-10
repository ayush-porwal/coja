import { isToolUIPart } from 'ai'
import { badRequest } from './errors.js'
import { REVIEW_TOOL_NAMES } from './tools.js'
import type { ChatMessage } from './types.js'

/**
 * What one conversation is allowed to feed the model. The browser re-sends the
 * whole conversation every turn (`ChatRequest.messages`), so without pruning
 * every tool result ever fetched would ride along in every request. Only the
 * model's copy is pruned here; the persisted conversation (`chats.messages_json`)
 * and the UI keep everything, as the transparency principle requires.
 */

/** Assistant messages, counted from the newest, whose tool results the model still sees in full. */
export const TOOL_OUTPUT_KEEP_TURNS = 4

/** What an elided tool result becomes: the model keeps the fact that it looked, not the payload. */
export const ELIDED_TOOL_OUTPUT = {
  elided: true,
  note: 'older tool result omitted to save context; ask again if needed',
} as const

const KNOWN_TOOL_PART_TYPES: ReadonlySet<string> = new Set(
  REVIEW_TOOL_NAMES.map((name) => `tool-${name}`),
)

/**
 * Refuse tool parts that are not one of the six review tools. `validateUIMessages`
 * would otherwise turn a terminal `tool-<unknown>` part into a `dynamic-tool`
 * part and hand its forged output to the model unvalidated; `dynamic-tool`
 * parts are never validated at all. Runs on the raw request body, before
 * validation. Entries that are not message- or part-shaped are left for the
 * validator to reject.
 */
export function assertKnownToolParts(messages: readonly unknown[]): void {
  messages.forEach((message, m) => {
    if (!isRecord(message) || !Array.isArray(message.parts)) return
    message.parts.forEach((part: unknown, p) => {
      if (!isRecord(part) || typeof part.type !== 'string') return
      const where = `messages[${m}].parts[${p}]`
      if (part.type === 'dynamic-tool') {
        throw badRequest(`invalid messages: ${where} is a dynamic-tool part, which is not accepted`)
      }
      if (part.type.startsWith('tool-') && !KNOWN_TOOL_PART_TYPES.has(part.type)) {
        throw badRequest(`invalid messages: ${where} has unknown tool part type "${part.type}"`)
      }
    })
  })
}

/**
 * A copy of `messages` for the model in which every completed tool result on
 * an assistant message older than the last `keep` assistant messages is
 * replaced by {@link ELIDED_TOOL_OUTPUT}. The part's state
 * (`output-available`), input and call id stay, so the transcript remains
 * well-formed and the model still knows what it looked at. Never mutates its
 * input; untouched messages and parts are returned as the same objects.
 */
export function pruneOlderToolOutputs(
  messages: readonly ChatMessage[],
  keep = TOOL_OUTPUT_KEEP_TURNS,
): ChatMessage[] {
  const assistants = messages.flatMap((m, i) => (m.role === 'assistant' ? [i] : []))
  const toPrune = new Set(assistants.slice(0, Math.max(0, assistants.length - keep)))
  return messages.map((message, i) => (toPrune.has(i) ? elideToolOutputs(message) : message))
}

function elideToolOutputs(message: ChatMessage): ChatMessage {
  let changed = false
  const parts = message.parts.map((part): ChatMessage['parts'][number] => {
    if (!isToolUIPart(part) || part.state !== 'output-available') return part
    changed = true
    // The typed tool outputs do not admit the placeholder; the model only ever sees it as JSON.
    return { ...part, output: ELIDED_TOOL_OUTPUT } as unknown as typeof part
  })
  return changed ? { ...message, parts } : message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
