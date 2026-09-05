import { type ChatGptErrorCode, parseChatGptMarker } from '@coja/shared/api'
import type { ChatStatus } from 'ai'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Button, ErrorNotice } from '../../ui'
import { formatRelative } from '../format'
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
  /** Sends the suggestion straight away (no composer round-trip). */
  onSuggest(text: string): void
  /** Human label for a `metadata.model` id. */
  modelLabel(id: string): string
  /** A key-billing model to switch to when the ChatGPT subscription fails — offered, never automatic. */
  apiFallbackModel?: string | null
  /** Applies the fallback model to the next message. */
  onSwitchModel?(id: string): void
}

const FAILURE_TITLES: Record<ChatGptErrorCode, string> = {
  state_mismatch: 'The ChatGPT sign-in failed',
  auth_expired: 'The ChatGPT sign-in expired',
  quota: 'The ChatGPT plan limit is reached',
  endpoint_changed: 'The ChatGPT subscription backend refused the request',
  transport: 'The ChatGPT subscription backend is unreachable',
}

/**
 * The conversation: user turns as right-aligned bubbles, answers as full-width
 * prose with the model and time under them, tool calls inline. Follows the
 * stream (auto-scrolls) until the user scrolls up; the request error shows
 * with Retry/Dismiss under the last message.
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
  apiFallbackModel = null,
  onSwitchModel,
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
  // No separate indicator here: the composer's card carries the working state
  // (dots + rotating phrase); this only keeps the empty-state hidden mid-turn.
  const thinking = status === 'submitted' || (status === 'streaming' && last?.role !== 'assistant')

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
      data-testid="message-list"
    >
      {messages.length === 0 && !thinking && (
        <Suggestions suggestions={suggestions} onSuggest={onSuggest} />
      )}
      <ol aria-label="Conversation" className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageView message={message} paths={paths} modelLabel={modelLabel} />
          </li>
        ))}
      </ol>
      {error && (
        <div className="mt-3">
          <ChatErrorNotice
            error={error}
            onRetry={onRetry}
            apiFallbackModel={apiFallbackModel}
            onSwitchModel={onSwitchModel}
            onDismissError={onDismissError}
            modelLabel={modelLabel}
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
        className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-ink"
      >
        <MessageParts message={message} paths={paths} />
      </article>
    )
  }
  const model = message.metadata?.model
  const createdAt = message.metadata?.createdAt
  return (
    <article aria-label="Assistant" className="min-w-0 text-ink">
      <MessageParts message={message} paths={paths} />
      {(model || createdAt) && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
          {model && (
            <span className="min-w-0 truncate" title={model}>
              {modelLabel(model)}
            </span>
          )}
          {model && createdAt && <span aria-hidden="true">·</span>}
          {createdAt && (
            <span className="shrink-0" title={createdAt}>
              {formatRelative(createdAt)}
            </span>
          )}
        </p>
      )}
    </article>
  )
}

export interface SuggestionsProps {
  suggestions: readonly string[]
  onSuggest(text: string): void
}

/**
 * The empty-conversation state: a centered prompt with suggestion pills that
 * send immediately — one click, one message.
 */
export function Suggestions({ suggestions, onSuggest }: SuggestionsProps) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-4 py-6 text-center">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-active text-muted"
      >
        <ChatIcon />
      </span>
      <div>
        <p className="font-medium text-ink">What should we look at?</p>
        <p className="mt-0.5 text-xs text-muted">
          Ask anything about this pull request — or start with one of these.
        </p>
      </div>
      <ul className="flex w-full max-w-sm flex-wrap justify-center gap-2" aria-label="Suggestions">
        {suggestions.map((text) => (
          <li key={text} className="max-w-full">
            <button
              type="button"
              onClick={() => onSuggest(text)}
              title={text}
              className="max-w-full cursor-pointer truncate rounded-full border border-edge bg-card px-3 py-1.5 text-xs text-muted transition-colors hover:border-edge-strong hover:bg-hover hover:text-ink"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-5">
      <path
        d="M2.5 3.5h11a.9.9 0 0 1 .9.9v6.2a.9.9 0 0 1-.9.9H8.4L5.2 14v-2.5H2.5a.9.9 0 0 1-.9-.9V4.4a.9.9 0 0 1 .9-.9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ChatErrorNoticeProps {
  error: Error
  onRetry(): void
  apiFallbackModel: string | null
  onSwitchModel?(id: string): void
  onDismissError(): void
  modelLabel(id: string): string
}

/**
 * The request error, honestly labelled: ChatGPT-subscription failures carry a
 * marker from the server, get their specific title, a reconnect path, and —
 * when an API-key model is configured — a one-click switch for the next
 * message. The switch is an explicit button, never an automatic swap.
 */
function ChatErrorNotice({
  error,
  onRetry,
  apiFallbackModel,
  onSwitchModel,
  onDismissError,
  modelLabel,
}: ChatErrorNoticeProps) {
  const described = describeChatError(error)
  const failure = parseChatGptMarker(described)
  if (!failure) {
    return <ErrorNotice title="The model request failed" message={described} onRetry={onRetry} />
  }
  return (
    <div className="flex flex-col gap-2">
      <ErrorNotice title={FAILURE_TITLES[failure.code]} message={failure.text} onRetry={onRetry} />
      <div className="flex flex-wrap items-center gap-2">
        {failure.code === 'auth_expired' && (
          <Link
            to="/setup"
            className="rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium hover:bg-hover"
          >
            Reconnect ChatGPT in Setup
          </Link>
        )}
        {apiFallbackModel && onSwitchModel && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSwitchModel(apiFallbackModel)
              onDismissError()
            }}
          >
            Switch to {modelLabel(apiFallbackModel)} for the next message
          </Button>
        )}
      </div>
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
