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
        <details className="group my-1 overflow-hidden rounded-lg border border-edge bg-canvas text-xs text-muted">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 px-2.5 py-1.5 transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
            >
              <path
                d="M9 9a3 3 0 1 1 4.4 2.65c-.9.52-1.4 1.1-1.4 2.1v.25"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="12" cy="18" r="0.6" fill="currentColor" />
            </svg>
            Reasoning{part.state === 'streaming' ? '…' : ''}
          </summary>
          <div className="whitespace-pre-wrap break-words border-edge border-t border-dashed bg-canvas px-2.5 py-2">
            {part.text}
          </div>
        </details>
      )
    case 'step-start':
      // Every model step begins with one; a divider before the very first part is noise.
      return index === 0 ? null : <hr className="my-2 border-edge border-t" />
    case 'file':
      return <p className="text-xs text-muted">Attachment: {part.filename ?? part.mediaType}</p>
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
    <section aria-label={`Tool call ${summary}`} className="my-1.5 text-xs">
      {/* Failed calls open by default so the error is seen without a click.
          One enveloping surface: the summary is the pill row, the payload
          opens directly beneath it inside the same rounded container. */}
      <details
        className="group overflow-hidden rounded-lg border border-edge bg-canvas"
        open={failed || undefined}
      >
        <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden">
          <ToolIcon />
          <code className="min-w-0 flex-1 truncate font-mono text-ink" title={summary}>
            {summary}
          </code>
          {running && <Spinner size="sm" label="Running" className="text-muted" />}
          {done && (
            <span role="img" aria-label="Completed" className="shrink-0 text-ok-text">
              ✓
            </span>
          )}
          {failed && (
            <span role="img" aria-label="Failed" className="shrink-0 text-danger-text">
              ✗
            </span>
          )}
          {!running && !done && !failed && (
            <span className="shrink-0 text-muted">{part.state}</span>
          )}
          <span className="shrink-0 text-faint">{done ? 'Result' : 'Input'}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="size-3 shrink-0 text-faint transition-transform group-open:rotate-180"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="max-h-80 overflow-auto border-edge border-t bg-canvas px-2.5 py-2">
          {failed && <p className="mb-1.5 break-words text-danger-text">{part.errorText}</p>}
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

function ToolIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="size-3.5 shrink-0 text-muted"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
    return <p className="text-muted">(no output)</p>
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
          <div className="mb-0.5 font-medium text-muted">{key}</div>
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
    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-ink leading-snug">
      {text}
    </pre>
  )
}
