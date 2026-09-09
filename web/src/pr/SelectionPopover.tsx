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
      className="absolute top-3 left-1/2 z-20 flex flex-wrap max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-edge bg-card px-3 py-1.5 text-sm shadow-lg"
    >
      {/* The only shrinking element: a long path truncates so the buttons never do. */}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onComment}
        disabled={busy}
        className="shrink-0 whitespace-nowrap rounded bg-accent px-2.5 py-1 font-medium text-xs text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        Comment
      </button>
      <button
        type="button"
        onClick={onAskAi}
        disabled={busy}
        className="shrink-0 whitespace-nowrap rounded border border-edge-strong px-2.5 py-1 font-medium text-xs text-ink hover:bg-hover disabled:opacity-50"
      >
        {busy ? 'Attaching…' : 'Ask AI'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Clear selection"
        className="shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-ink"
      >
        ×
      </button>
      {error && (
        <span role="alert" className="basis-full break-words text-xs text-danger-text">
          {error}
        </span>
      )}
    </div>
  )
}
