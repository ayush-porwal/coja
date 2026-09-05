import type { ContextChip, PullRequestDetail } from '@coja/shared/api'
import { useEffect, useState } from 'react'
import { bridge } from '../bridge'

/**
 * Props are the stable contract with the review screen: the next stage swaps
 * this file's internals (chat, model picker, tool-call rendering) but keeps
 * the component name and these props.
 */
export interface AiPanelProps {
  projectId: string
  number: number
  detail: PullRequestDetail
}

/**
 * The AI panel frame. This stage implements the frame plus the composer's
 * context-chip strip (fed by `bridge.onAttachSelection`); the chat itself
 * arrives in the next stage.
 */
export function AiPanel({ detail }: AiPanelProps) {
  const [chips, setChips] = useState<ContextChip[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => bridge.onAttachSelection((chip) => setChips((prev) => [...prev, chip])), [])

  const removeChip = (id: string) => setChips((prev) => prev.filter((c) => c.id !== id))

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-sm dark:bg-zinc-950">
      <header className="flex h-10 shrink-0 items-center gap-2 border-zinc-200 border-b px-3 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">AI</h2>
        <select
          disabled
          aria-label="Model"
          title="Model picker arrives in the next stage"
          className="ml-auto max-w-[11rem] rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          defaultValue=""
        >
          <option value="">Model</option>
        </select>
        <button
          type="button"
          disabled
          title="Chat arrives in the next stage"
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 disabled:opacity-60 dark:border-zinc-700"
        >
          New chat
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 text-zinc-500">
        <p className="text-xs leading-relaxed">
          Ask about{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{detail.title}</span>.
          Select lines in the diff and choose <span className="font-medium">Ask AI</span> to attach
          them as context — every chip below shows exactly what the model will receive.
        </p>
      </div>

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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          aria-label="Message"
          placeholder="Ask about this PR…"
          className="w-full resize-none rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-1.5 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {chips.length > 0
              ? `${chips.length} context ${chips.length === 1 ? 'chip' : 'chips'}`
              : ''}
          </span>
          <button
            type="button"
            disabled
            title="AI panel arrives in the next stage"
            className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  )
}

interface ContextChipViewProps {
  chip: ContextChip
  onRemove(): void
}

/** `path:start–end @ ref` with an expand toggle that reveals the exact excerpt. */
export function ContextChipView({ chip, onRemove }: ContextChipViewProps) {
  const [expanded, setExpanded] = useState(false)
  const lines =
    chip.startLine === chip.endLine ? `${chip.startLine}` : `${chip.startLine}–${chip.endLine}`
  const label = `${chip.path}:${lines} @ ${chip.ref}`
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-mono text-zinc-700 hover:underline dark:text-zinc-200"
          title={expanded ? 'Hide excerpt' : 'Show the exact text sent to the model'}
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-zinc-400">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        >
          ×
        </button>
      </div>
      {expanded && (
        <pre className="max-h-64 overflow-auto border-zinc-200 border-t px-2 py-1.5 font-mono text-[11px] text-zinc-800 leading-snug dark:border-zinc-700 dark:text-zinc-200">
          {chip.text}
        </pre>
      )}
    </div>
  )
}
