/**
 * Client-side chat types for the AI panel (design.md §4).
 *
 * `ChatMessage` is the Vercel AI SDK UIMessage specialised with the wire
 * contract's metadata and data-part shapes. Tools stay the default `UITools`
 * so any `tool-*` part renders generically — the six tool names below are
 * what the server exposes today, used only for the compact call summaries.
 */

import type { UIMessage } from 'ai'
import type { ChatDataParts, ChatMessageMetadata, ContextChip } from './contracts.js'

export type ChatMessage = UIMessage<ChatMessageMetadata, ChatDataParts>
export type ChatMessagePart = ChatMessage['parts'][number]

export { REVIEW_TOOL_NAMES as TOOL_NAMES, type ReviewToolName as ToolName } from './tool-names.js'

import type { ReviewToolName as ToolName } from './tool-names.js'
import type { ReviewToolsUI } from './types.js'
export type ToolInputs = { [K in ToolName]: ReviewToolsUI[K]['input'] }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural check for a chip carried in a `data-chip` part (persisted data may be anything). */
export function isContextChip(value: unknown): value is ContextChip {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.kind === 'selection' &&
    typeof value.path === 'string' &&
    (value.ref === 'base' || value.ref === 'head') &&
    (value.side === 'LEFT' || value.side === 'RIGHT') &&
    typeof value.startLine === 'number' &&
    typeof value.endLine === 'number' &&
    typeof value.text === 'string'
  )
}

/** Keeps the entries of a persisted `ChatWithMessages.messages` that look like UI messages. */
export function asChatMessages(messages: readonly unknown[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (
      isRecord(m) &&
      typeof m.id === 'string' &&
      (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
      Array.isArray(m.parts)
    ) {
      out.push(m as unknown as ChatMessage)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Tool call summaries — the compact form rendered as a tool card's header
// ---------------------------------------------------------------------------

/**
 * `read_file(head, src/auth.ts:41-58)`, `grep(head, "TTL")`, `get_diff(src/index.ts)`,
 * `git_log()`. Tolerates a partial `input` (while the model is still streaming
 * the arguments) by leaving out what is not there yet.
 */
export function summarizeToolCall(name: string, input: unknown): string {
  const args = isRecord(input) ? input : {}
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const num = (key: string) => (typeof args[key] === 'number' ? (args[key] as number) : undefined)

  switch (name) {
    case 'read_file':
    case 'git_blame':
      return call(name, [str('ref'), withRange(str('path'), num('startLine'), num('endLine'))])
    case 'list_files':
      return call(name, [str('ref'), str('path')])
    case 'grep': {
      const pattern = str('pattern')
      return call(name, [
        str('ref'),
        pattern === undefined ? undefined : JSON.stringify(pattern),
        str('pathspec'),
        args.ignoreCase === true ? 'ignoreCase' : undefined,
      ])
    }
    case 'get_diff':
      return call(name, [str('file')])
    case 'git_log': {
      const maxCount = num('maxCount')
      return call(name, [str('path'), maxCount === undefined ? undefined : `maxCount=${maxCount}`])
    }
    default:
      return call(
        name,
        Object.entries(args).map(([key, value]) => `${key}=${formatValue(value)}`),
      )
  }
}

function call(name: string, parts: ReadonlyArray<string | undefined>): string {
  return `${name}(${parts.filter((p): p is string => p !== undefined).join(', ')})`
}

/** `path`, `path:41`, `path:41-58`, `path:41-` (to the end) or `path:-58` (from the start). */
function withRange(path: string | undefined, start?: number, end?: number): string | undefined {
  if (path === undefined) return undefined
  if (start === undefined && end === undefined) return path
  if (start !== undefined && end !== undefined) {
    return start === end ? `${path}:${start}` : `${path}:${start}-${end}`
  }
  return start !== undefined ? `${path}:${start}-` : `${path}:-${end}`
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return /^[\w./*@-]+$/.test(value) ? value : JSON.stringify(value)
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
