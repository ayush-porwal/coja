interface SelectionPopoverProps {
  /** e.g. `src/auth.ts L12–L18 (new)` */
  label: string
  busy: boolean
  error: string | null
  onComment(): void
  onAskAi(): void
  onDismiss(): void
}

/**
 * The two-action popover for a line selection (design.md §3): Comment into the
 * pending review, or attach the selection to the AI composer. Rendered as a
 * floating toolbar pinned to the top of the diff pane.
 */
export function SelectionPopover({
  label,
  busy,
  error,
  onComment,
  onAskAi,
  onDismiss,
}: SelectionPopoverProps) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onComment}
        disabled={busy}
        className="rounded bg-blue-600 px-2.5 py-1 font-medium text-white text-xs hover:bg-blue-700 disabled:opacity-50"
      >
        Comment
      </button>
      <button
        type="button"
        onClick={onAskAi}
        disabled={busy}
        className="rounded border border-zinc-300 px-2.5 py-1 font-medium text-xs text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {busy ? 'Attaching…' : 'Ask AI'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Clear selection"
        className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        ×
      </button>
      {error && (
        <span role="alert" className="text-red-600 text-xs dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}
