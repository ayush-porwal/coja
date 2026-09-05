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
import { Button } from '../../ui'
import { bridge } from '../bridge'
import { errorMessage } from '../errors'
import { ContextChipView } from './ContextChipView'
import type { ChatMessage } from './types'

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
  /** A turn is in flight: the textarea locks and Send becomes Stop. */
  streaming: boolean
  /** No model available: everything is disabled and `disabledReason` shows. */
  disabled: boolean
  disabledReason?: string
  /** Something else is in flight (creating the chat): Send waits. */
  busy?: boolean
}

/** Chips (in order) followed by the text — exactly what the server converts for the model. */
export function toMessageParts(chips: readonly ContextChip[], text: string): ChatMessage['parts'] {
  return [
    ...chips.map((chip) => ({ type: 'data-chip' as const, id: chip.id, data: chip })),
    { type: 'text' as const, text },
  ]
}

/**
 * The composer (design.md §4): the context-chip strip fed by "Ask AI"
 * (`bridge.onAttachSelection`), an auto-growing textarea (Enter sends,
 * Shift+Enter breaks the line) and Send/Stop.
 */
export function Composer({
  ref,
  onSend,
  onStop,
  streaming,
  disabled,
  disabledReason,
  busy = false,
}: ComposerProps) {
  const [chips, setChips] = useState<ContextChip[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

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
    <footer className="shrink-0 border-zinc-200 border-t p-2 dark:border-zinc-800">
      {chips.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1" aria-label="Attached context">
          {chips.map((chip) => (
            <li key={chip.id}>
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
        rows={2}
        disabled={disabled || streaming}
        aria-label="Message"
        placeholder={
          disabled
            ? (disabledReason ?? 'AI is unavailable')
            : streaming
              ? 'Waiting for the answer…'
              : 'Ask about this PR… (Enter to send, Shift+Enter for a new line)'
        }
        className="min-h-[3.25rem] w-full resize-none rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="min-w-0 truncate">
          {error ? (
            <span role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : chips.length > 0 ? (
            `${chips.length} context ${chips.length === 1 ? 'chip' : 'chips'}`
          ) : (
            ''
          )}
        </span>
        {streaming ? (
          <Button size="sm" variant="secondary" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void send()} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </footer>
  )
}
