import type { ContextChip } from '@coja/shared/api'
import {
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { bridge } from '../bridge'
import { errorMessage } from '../errors'
import { ContextChipView } from './ContextChipView'
import type { ChatMessage } from './types'
import { useWorkingPhrase } from './workingPhrase'

/** Sent as the text when the user submits chips without typing anything. */
export const DEFAULT_CHIP_PROMPT = 'What about this selection?'
const MAX_TEXTAREA_PX = 240

export interface ComposerHandle {
  /** Replaces the draft (used by the empty-state suggestions) and focuses the textarea. */
  insert(text: string): void
  focus(): void
}

export interface ComposerProps {
  ref?: Ref<ComposerHandle>
  /**
   * Called with the user message's parts (chips first, then the text). The
   * composer clears itself when this returns/resolves; a rejection keeps the
   * draft and shows the error.
   */
  onSend(parts: ChatMessage['parts']): void | Promise<void>
  onStop(): void
  /** A turn is in flight: Send becomes Stop; the draft stays editable for the next question. */
  streaming: boolean
  /** No model available: everything is disabled and `disabledReason` shows. */
  disabled: boolean
  disabledReason?: string
  /** Something else is in flight (creating the chat): Send waits. */
  busy?: boolean
  /** Notified whenever the number of attached (unsent) chips changes — the collapsed-panel badge reads it. */
  onChipsChange?: (count: number) => void
  /**
   * Rendered in the bottom action row on the right, immediately before the
   * send/stop button — a fixed anchor, so status text of any length never
   * shifts the model picker's position.
   */
  actions?: React.ReactNode
}

/** Chips (in order) followed by the text — exactly what the server converts for the model. */
export function toMessageParts(chips: readonly ContextChip[], text: string): ChatMessage['parts'] {
  return [
    ...chips.map((chip) => ({ type: 'data-chip' as const, id: chip.id, data: chip })),
    { type: 'text' as const, text },
  ]
}

/**
 * The composer: one card holding the context-chip strip (fed by "Ask AI" via
 * `bridge.onAttachSelection`), an auto-growing textarea (Enter sends,
 * Shift+Enter breaks the line) and the send/stop controls. While an answer
 * streams the card shows a live "Generating" indicator and Stop — which
 * aborts the request end to end (the server cancels the provider call) — and
 * the reviewer can already draft the next question.
 */
export function Composer({
  ref,
  onSend,
  onStop,
  streaming,
  disabled,
  disabledReason,
  busy = false,
  onChipsChange,
  actions,
}: ComposerProps) {
  const [chips, setChips] = useState<ContextChip[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    onChipsChange?.(chips.length)
  }, [chips.length, onChipsChange])

  useEffect(
    () =>
      bridge.onAttachSelection((chip) => {
        setChips((prev) => (prev.some((c) => c.id === chip.id) ? prev : [...prev, chip]))
        textarea.current?.focus()
      }),
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      insert(text) {
        setDraft(text)
        textarea.current?.focus()
      },
      focus() {
        textarea.current?.focus()
      },
    }),
    [],
  )

  // Auto-grow with the content, up to a cap; the CSS min-height is the floor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure after every draft change
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`
  }, [draft])

  const text = draft.trim()
  const canSend = !disabled && !busy && !sending && !streaming && (text !== '' || chips.length > 0)

  const send = async () => {
    if (!canSend) return
    const parts = toMessageParts(chips, text !== '' ? text : DEFAULT_CHIP_PROMPT)
    setError(null)
    setSending(true)
    try {
      await onSend(parts)
      setDraft('')
      setChips([])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const removeChip = (id: string) => setChips((prev) => prev.filter((c) => c.id !== id))

  return (
    <footer className="shrink-0 border-edge border-t p-2">
      <div
        className={`rounded-xl border bg-card transition-colors ${
          focused ? 'border-accent' : 'border-edge-strong'
        }`}
      >
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-2 pt-2" aria-label="Attached context">
            {chips.map((chip) => (
              <li key={chip.id} className="min-w-0 max-w-full">
                <ContextChipView chip={chip} onRemove={() => removeChip(chip.id)} />
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={2}
          disabled={disabled}
          aria-label="Message"
          placeholder={
            disabled
              ? (disabledReason ?? 'No model provider configured')
              : streaming
                ? 'Working — draft your next question while this one finishes'
                : 'Ask about this pull request…'
          }
          className="max-h-[240px] min-h-[3.25rem] w-full resize-none bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-faint disabled:opacity-60"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="max-w-[45%] min-w-0 shrink truncate text-xs">
            {error ? (
              <span role="alert" className="text-danger-text">
                {error}
              </span>
            ) : streaming ? (
              <WorkingIndicator active />
            ) : chips.length > 0 ? (
              <span className="text-muted">
                {chips.length} {chips.length === 1 ? 'selection' : 'selections'} attached
              </span>
            ) : (
              ''
            )}
          </span>
          <span aria-hidden="true" className="min-w-1 flex-1" />
          {actions}
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-edge-strong px-2.5 py-1.5 text-xs font-medium text-ink hover:border-danger hover:text-danger-text"
              title="Stop generating — cancels the request and the provider call"
            >
              <StopIcon />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              aria-label="Send"
              title="Send (Enter)"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </footer>
  )
}

/** Live in-card indicator while a turn is in flight; the phrase rotates. */
function WorkingIndicator({ active }: { active: boolean }) {
  const phrase = useWorkingPhrase(active)
  return (
    <span className="flex items-center gap-1.5 text-muted" role="status">
      <span className="flex gap-0.5">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      {phrase}
    </span>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-1 motion-safe:animate-bounce rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  )
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
      <path
        d="M8 13V3.5M8 3.5 3.5 8M8 3.5 12.5 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-3">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  )
}
