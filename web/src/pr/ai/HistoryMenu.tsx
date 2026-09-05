import type { Chat } from '@coja/shared/api'
import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../../ui'
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
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const count = chats?.length ?? 0

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="true"
        aria-expanded={open}
        title="Chat history"
        onClick={() => setOpen((v) => !v)}
      >
        History{count > 0 ? ` (${count})` : ''}
      </Button>
      {open && (
        <section
          aria-label="Chat history"
          className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {loading && !chats ? (
            <div className="flex items-center gap-2 px-2 py-2 text-zinc-500">
              <Spinner size="sm" /> Loading…
            </div>
          ) : count === 0 ? (
            <p className="px-2 py-2 text-zinc-500">No chats for this pull request yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
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
                      }}
                      className={`flex min-w-0 flex-1 flex-col rounded px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        current ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                      }`}
                    >
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                        {title}
                        {current && (
                          <span className="ml-1 font-normal text-zinc-500">· current</span>
                        )}
                      </span>
                      <span className="text-zinc-500" title={formatAbsolute(chat.updatedAt)}>
                        {formatRelative(chat.updatedAt)} · {chat.model}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat ${title}`}
                      title="Delete chat"
                      onClick={() => onDelete(chat.id)}
                      className="shrink-0 rounded px-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
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
