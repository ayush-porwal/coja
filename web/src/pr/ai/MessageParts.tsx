import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import { getToolName, isToolUIPart } from 'ai'
import { Spinner } from '../../ui'
import { ContextChipView } from './ContextChipView'
import { AssistantMarkdown } from './Markdown'
import {
  type ChatMessage,
  type ChatMessagePart,
  isContextChip,
  isRecord,
  summarizeToolCall,
} from './types'
import { safeHttpUrl } from './urls'

export interface MessagePartsProps {
  message: ChatMessage
  /** Changed-file paths, for citations in assistant text. */
  paths: readonly string[]
}

/**
 * Renders a message's parts in order (design.md §4, "messages show everything"):
 * chips, text, reasoning, step dividers and every tool call with its result.
 */
export function MessageParts({ message, paths }: MessagePartsProps) {
  return (
    <>
      {message.parts.map((part, index) => (
        <Part
          key={partKey(part, index)}
          part={part}
          index={index}
          role={message.role}
          paths={paths}
        />
      ))}
    </>
  )
}

function partKey(part: ChatMessagePart, index: number): string {
  if (isToolUIPart(part)) return `tool-${part.toolCallId}`
  return `${part.type}-${index}`
}

interface PartProps {
  part: ChatMessagePart
  index: number
  role: ChatMessage['role']
  paths: readonly string[]
}

function Part({ part, index, role, paths }: PartProps) {
  if (isToolUIPart(part)) return <ToolCallCard part={part} />
  switch (part.type) {
    case 'text':
      if (part.text === '') return null
      return role === 'assistant' ? (
        <AssistantMarkdown text={part.text} paths={paths} />
      ) : (
        <p className="whitespace-pre-wrap break-words">{part.text}</p>
      )
    case 'reasoning':
      if (part.text === '' && part.state !== 'streaming') return null
      return (
        <details className="my-1 rounded border border-zinc-200 border-dashed text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <summary className="cursor-pointer select-none px-2 py-1">
            Reasoning{part.state === 'streaming' ? '…' : ''}
          </summary>
          <div className="whitespace-pre-wrap break-words border-zinc-200 border-t border-dashed px-2 py-1.5 dark:border-zinc-700">
            {part.text}
          </div>
        </details>
      )
    case 'step-start':
      // Every model step begins with one; a divider before the very first part is noise.
      return index === 0 ? null : (
        <hr className="my-2 border-zinc-200 border-t dark:border-zinc-800" />
      )
    case 'file':
      return <p className="text-xs text-zinc-500">Attachment: {part.filename ?? part.mediaType}</p>
    case 'source-url': {
      // Same policy as links in markdown: only http(s) becomes a link, anything else is text.
      const href = safeHttpUrl(part.url)
      const label = part.title ?? part.url
      return (
        <p className="text-xs">
          Source:{' '}
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="underline">
              {label}
            </a>
          ) : (
            <span className="break-all">{label}</span>
          )}
        </p>
      )
    }
    default:
      if (part.type === 'data-chip' && isContextChip(part.data)) {
        return (
          <div className="my-1">
            <ContextChipView chip={part.data} />
          </div>
        )
      }
      return null
  }
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export interface ToolCallCardProps {
  part: ToolUIPart | DynamicToolUIPart
}

/**
 * One tool call: `read_file(head, src/auth.ts:41-58)` with its status, and a
 * collapsed but always-available "Result" (or "Input" while it runs) so every
 * byte the model saw can be inspected.
 */
export function ToolCallCard({ part }: ToolCallCardProps) {
  const name = getToolName(part)
  const summary = summarizeToolCall(name, part.input)
  const running = part.state === 'input-streaming' || part.state === 'input-available'
  const done = part.state === 'output-available'
  const failed = part.state === 'output-error'

  return (
    <section
      aria-label={`Tool call ${summary}`}
      className="my-1.5 rounded border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <code
          className="min-w-0 flex-1 truncate font-mono text-zinc-800 dark:text-zinc-200"
          title={summary}
        >
          {summary}
        </code>
        {running && <Spinner size="sm" label="Running" className="text-zinc-500" />}
        {done && (
          <span
            role="img"
            aria-label="Completed"
            className="text-emerald-600 dark:text-emerald-400"
          >
            ✓
          </span>
        )}
        {failed && (
          <span role="img" aria-label="Failed" className="text-red-600 dark:text-red-400">
            ✗
          </span>
        )}
        {!running && !done && !failed && <span className="text-zinc-500">{part.state}</span>}
      </div>
      {failed && (
        <p className="break-words border-zinc-200 border-t px-2 py-1 text-red-700 dark:border-zinc-700 dark:text-red-300">
          {part.errorText}
        </p>
      )}
      <details className="border-zinc-200 border-t dark:border-zinc-700">
        <summary className="cursor-pointer select-none px-2 py-1 text-zinc-600 dark:text-zinc-400">
          {done ? 'Result' : 'Input'}
        </summary>
        <div className="max-h-80 overflow-auto px-2 py-1.5">
          {done ? (
            <ToolOutput output={part.output} />
          ) : (
            <JsonBlock value={part.input} empty="(no arguments yet)" />
          )}
        </div>
      </details>
    </section>
  )
}

const LONG_TEXT = 100

/**
 * A tool result: strings as `<pre>`; objects as pretty JSON, with long text
 * fields (`content`, `patch`, notes…) pulled out into their own `<pre>` so a
 * file body is readable rather than a JSON-escaped line.
 */
function ToolOutput({ output }: { output: unknown }) {
  if (output === undefined || output === null) {
    return <p className="text-zinc-500">(no output)</p>
  }
  if (typeof output === 'string') return <Pre text={output} />
  if (!isRecord(output)) return <JsonBlock value={output} empty="(empty)" />

  const long: [string, string][] = []
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === 'string' && (value.includes('\n') || value.length > LONG_TEXT)) {
      long.push([key, value])
    } else {
      rest[key] = value
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      {Object.keys(rest).length > 0 && <JsonBlock value={rest} empty="{}" />}
      {long.map(([key, value]) => (
        <div key={key}>
          <div className="mb-0.5 font-medium text-zinc-500">{key}</div>
          <Pre text={value} />
        </div>
      ))}
    </div>
  )
}

function JsonBlock({ value, empty }: { value: unknown; empty: string }) {
  let text: string
  try {
    text = value === undefined ? empty : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return <Pre text={text} />
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-800 leading-snug dark:text-zinc-200">
      {text}
    </pre>
  )
}
