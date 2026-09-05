import type { ChatStatus } from 'ai'
import { useEffect, useRef } from 'react'
import { Button, ErrorNotice, Spinner } from '../../ui'
import { MessageParts } from './MessageParts'
import type { ChatMessage } from './types'

/** Below this distance from the bottom (px) the list keeps following the stream. */
const STICK_THRESHOLD_PX = 48

export interface MessageListProps {
  messages: readonly ChatMessage[]
  status: ChatStatus
  error: Error | undefined
  onRetry(): void
  onDismissError(): void
  /** Changed-file paths, for citations. */
  paths: readonly string[]
  suggestions: readonly string[]
  onSuggest(text: string): void
  /** Human label for a `metadata.model` id. */
  modelLabel(id: string): string
}

/**
 * The conversation. Follows the stream (auto-scrolls) until the user scrolls
 * up; shows the request error with Retry/Dismiss under the last message.
 */
export function MessageList({
  messages,
  status,
  error,
  onRetry,
  onDismissError,
  paths,
  suggestions,
  onSuggest,
  modelLabel,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the stream as content arrives
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, status, error])

  const last = messages[messages.length - 1]
  const thinking = status === 'submitted' || (status === 'streaming' && last?.role !== 'assistant')

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      data-testid="message-list"
    >
      {messages.length === 0 && !thinking && (
        <Suggestions suggestions={suggestions} onSuggest={onSuggest} />
      )}
      <ol aria-label="Conversation" className="flex flex-col gap-3">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageView message={message} paths={paths} modelLabel={modelLabel} />
          </li>
        ))}
      </ol>
      {thinking && (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500" role="status">
          <Spinner size="sm" />
          Thinking…
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNotice
            title="The model request failed"
            message={describeChatError(error)}
            onRetry={onRetry}
          />
          <Button size="sm" variant="ghost" className="mt-1" onClick={onDismissError}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}

interface MessageViewProps {
  message: ChatMessage
  paths: readonly string[]
  modelLabel(id: string): string
}

function MessageView({ message, paths, modelLabel }: MessageViewProps) {
  if (message.role === 'user') {
    return (
      <article
        aria-label="You"
        className="ml-6 rounded-lg bg-blue-50 px-3 py-2 text-zinc-900 dark:bg-blue-950/40 dark:text-zinc-100"
      >
        <MessageParts message={message} paths={paths} />
      </article>
    )
  }
  const model = message.metadata?.model
  return (
    <article aria-label="Assistant" className="min-w-0 text-zinc-900 dark:text-zinc-100">
      <MessageParts message={message} paths={paths} />
      {model && (
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500" title={model}>
          {modelLabel(model)}
        </p>
      )}
    </article>
  )
}

export interface SuggestionsProps {
  suggestions: readonly string[]
  onSuggest(text: string): void
}

/** Empty-conversation prompts; each fills the composer (it does not send). */
export function Suggestions({ suggestions, onSuggest }: SuggestionsProps) {
  return (
    <div className="mb-3 text-xs text-zinc-500">
      <p className="leading-relaxed">
        Ask about this pull request. Select lines in the diff and choose{' '}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Ask AI</span> to attach them
        as context — every chip shows exactly what the model receives.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5" aria-label="Suggestions">
        {suggestions.map((text) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onSuggest(text)}
              className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The SDK surfaces a non-2xx chat response as `new Error(<response text>)`,
 * i.e. the server's JSON `{ error }` body; unwrap it for the reviewer.
 */
export function describeChatError(error: Error): string {
  const raw = error.message
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const message = (parsed as { error: unknown }).error
      if (typeof message === 'string' && message !== '') return message
    }
  } catch {
    // not JSON
  }
  return raw === '' ? 'Unknown error' : raw
}
