import type { Chat } from '@coja/shared/api'
import { useEffect, useId, useRef, useState } from 'react'
import { Spinner } from '../../ui'
import { formatAbsolute, formatRelative } from '../format'

export interface HistoryMenuProps {
  chats: readonly Chat[] | undefined
  loading: boolean
  currentId: string | null
  onSelect(chatId: string): void
  onDelete(chatId: string): void
}

/** Title for a chat: its first message, or "New chat" until there is one. */
export function chatTitle(chat: Chat): string {
  return chat.title && chat.title.trim() !== '' ? chat.title : 'New chat'
}

/**
 * The chat history dropdown: this PR's chats newest first, the current one
 * marked; pick one to switch, × to delete.
 */
export function HistoryMenu({ chats, loading, currentId, onSelect, onDelete }: HistoryMenuProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const first =
      panel?.querySelector<HTMLButtonElement>('button[aria-current="true"]') ??
      panel?.querySelector<HTMLButtonElement>('button')
    ;(first ?? panel)?.focus()
    const onPointerDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  const count = chats?.length ?? 0

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        title={count > 0 ? `Chat history (${count})` : 'Chat history'}
        aria-label={count > 0 ? `History (${count})` : 'History'}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink"
      >
        <ClockIcon />
        {count > 0 && (
          <span className="absolute -top-0.5 left-full ml-[-0.4rem] min-w-3.5 rounded-full bg-accent px-1 text-[9px] font-semibold leading-3.5 text-accent-ink">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <section
          ref={panelRef}
          tabIndex={-1}
          id={panelId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              triggerRef.current?.focus()
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !root.current?.contains(event.relatedTarget)
            ) {
              setOpen(false)
            }
          }}
          aria-label="Chat history"
          className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-edge bg-card p-1 text-xs shadow-lg"
        >
          {loading && !chats ? (
            <div className="flex items-center gap-2 px-2 py-2 text-muted">
              <Spinner size="sm" /> Loading…
            </div>
          ) : count === 0 ? (
            <p className="px-2 py-2 text-muted">No chats for this pull request yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto overscroll-contain">
              {(chats ?? []).map((chat) => {
                const current = chat.id === currentId
                const title = chatTitle(chat)
                return (
                  <li key={chat.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        onSelect(chat.id)
                        setOpen(false)
                        triggerRef.current?.focus()
                      }}
                      className={`flex min-w-0 flex-1 flex-col rounded px-2 py-1.5 text-left hover:bg-hover ${
                        current ? 'bg-active' : ''
                      }`}
                    >
                      <span className="truncate font-medium text-ink">
                        {title}
                        {current && <span className="ml-1 font-normal text-muted">· current</span>}
                      </span>
                      <span
                        className="w-full truncate text-muted"
                        title={`${formatAbsolute(chat.updatedAt)} · ${chat.model}`}
                      >
                        {formatRelative(chat.updatedAt)} · {chat.model}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat ${title}`}
                      title="Delete chat"
                      onClick={() => {
                        setOpen(false)
                        triggerRef.current?.focus()
                        onDelete(chat.id)
                      }}
                      className="shrink-0 rounded px-2 text-faint hover:bg-hover hover:text-danger-text"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
