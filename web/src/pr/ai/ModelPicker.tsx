import type { ModelInfo, ProviderId } from '@coja/shared/api'

const PROVIDER_LABELS: Record<ProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic' }

export interface ModelPickerProps {
  models: readonly ModelInfo[]
  value: string
  onChange(id: string): void
  disabled?: boolean
}

/** Header model picker: a native `<select>` grouped by provider (design.md §4). */
export function ModelPicker({ models, value, onChange, disabled }: ModelPickerProps) {
  const groups = new Map<ProviderId, ModelInfo[]>()
  for (const model of models) {
    const list = groups.get(model.provider)
    if (list) list.push(model)
    else groups.set(model.provider, [model])
  }
  const empty = models.length === 0
  return (
    <select
      aria-label="Model"
      title={empty ? 'No AI provider configured' : 'Model for the next message'}
      value={empty ? '' : value}
      disabled={disabled || empty}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 min-w-0 max-w-[11rem] flex-1 truncate rounded border border-zinc-300 bg-white px-1.5 text-xs text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {empty && <option value="">No models</option>}
      {[...groups.entries()].map(([provider, list]) => (
        <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
          {list.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
