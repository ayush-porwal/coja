import type { ContextChip } from '@coja/shared/api'
import { useState } from 'react'

export interface ContextChipViewProps {
  chip: ContextChip
  /** Present in the composer (chips are removable before sending); absent in sent messages. */
  onRemove?: () => void
}

/** `path:41–58 @ head` — human label for a chip. */
export function chipLabel(chip: ContextChip): string {
  const lines =
    chip.startLine === chip.endLine ? `${chip.startLine}` : `${chip.startLine}–${chip.endLine}`
  return `${chip.path}:${lines} @ ${chip.ref}`
}

/**
 * A context chip: `path:start–end @ ref` with an expand toggle that reveals
 * the exact excerpt the model receives (design.md §4 — nothing hidden).
 */
export function ContextChipView({ chip, onRemove }: ContextChipViewProps) {
  const [expanded, setExpanded] = useState(false)
  const label = chipLabel(chip)
  return (
    <div className="max-w-full rounded-lg border border-edge bg-canvas text-xs">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-mono text-ink hover:underline"
          title={expanded ? 'Hide excerpt' : 'Show the exact text sent to the model'}
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-faint">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="truncate">{label}</span>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="shrink-0 rounded px-1 text-muted hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
      {expanded && (
        <pre
          data-testid="chip-excerpt"
          className="max-h-64 overflow-auto rounded-b-lg border-edge border-t bg-canvas px-2 py-1.5 font-mono text-xs text-ink leading-snug"
        >
          {chip.text}
        </pre>
      )}
    </div>
  )
}
