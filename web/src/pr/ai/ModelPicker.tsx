import type { ModelInfo, ModelReasoningEffort } from '@coja/shared/api'
import { useEffect, useId, useRef, useState } from 'react'

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT (subscription)',
}

export interface ModelPickerProps {
  models: readonly ModelInfo[]
  value: string
  onChange(id: string): void
  disabled?: boolean
}

/**
 * The model picker: a compact pill above the composer opening an upward
 * dropdown grouped by provider. Keyboard-navigable (arrows, Enter, Escape,
 * Home/End) with ARIA combobox/listbox wiring; the native `<select>` it
 * replaced could not be styled or open upward.
 */
export function ModelPicker({ models, value, onChange, disabled }: ModelPickerProps) {
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const list = groups.get(model.provider)
    if (list) list.push(model)
    else groups.set(model.provider, [model])
  }
  const flat = [...models]
  const selected = models.find((m) => m.id === value)
  const empty = models.length === 0

  return (
    <Dropdown
      ariaLabel="Model"
      title={empty ? 'No model provider configured' : 'Model for the next message'}
      disabled={disabled || empty}
      trigger={
        <>
          <span className="min-w-0 truncate">
            {empty ? 'No models' : (selected?.label ?? 'Select a model')}
          </span>
          <Chevron />
        </>
      }
    >
      {(highlight, setHighlight, close, optionId) =>
        flat.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted">No models</p>
        ) : (
          [...groups.entries()].map(([provider, list]) => (
            // biome-ignore lint/a11y/useSemanticElements: group is the correct listbox child; a fieldset may not structure options
            <div
              key={provider}
              role="group"
              aria-label={PROVIDER_LABELS[provider] ?? list[0]?.providerLabel ?? provider}
            >
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold tracking-wide text-faint uppercase">
                {PROVIDER_LABELS[provider] ?? list[0]?.providerLabel ?? provider}
              </p>
              {list.map((model) => {
                const flatIndex = flat.findIndex((m) => m.id === model.id)
                return (
                  <DropdownOption
                    key={model.id}
                    id={optionId(flatIndex)}
                    selected={model.id === value}
                    highlighted={flat[highlight]?.id === model.id}
                    onHover={() => setHighlight(flatIndex)}
                    onClick={() => {
                      onChange(model.id)
                      close()
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  </DropdownOption>
                )
              })}
            </div>
          ))
        )
      }
    </Dropdown>
  )
}

export interface EffortPickerProps {
  efforts: readonly ModelReasoningEffort[]
  value: string | null
  onChange(effort: string): void
}

/** Reasoning-effort pill (ChatGPT subscription catalog); hidden when the model publishes none. */
export function EffortPicker({ efforts, value, onChange }: EffortPickerProps) {
  if (efforts.length === 0) return null
  const current = value ?? efforts[0]?.effort ?? ''
  return (
    <Dropdown
      ariaLabel="Reasoning effort"
      title="Reasoning effort for the next message"
      trigger={
        <>
          <span className="capitalize">{current}</span>
          <Chevron />
        </>
      }
    >
      {(highlight, setHighlight, close, optionId) =>
        efforts.map((level, index) => (
          <DropdownOption
            key={level.effort}
            id={optionId(index)}
            selected={level.effort === current}
            highlighted={highlight === index}
            onHover={() => setHighlight(index)}
            onClick={() => {
              onChange(level.effort)
              close()
            }}
            title={level.description}
          >
            <span className="min-w-0 flex-1 truncate capitalize">{level.effort}</span>
            {level.description && (
              <span className="ml-2 min-w-0 truncate text-[10px] text-faint">
                {level.description}
              </span>
            )}
          </DropdownOption>
        ))
      }
    </Dropdown>
  )
}

// ---------------------------------------------------------------------------
// Shared dropdown shell
// ---------------------------------------------------------------------------

interface DropdownProps {
  ariaLabel: string
  title: string
  disabled?: boolean
  trigger: React.ReactNode
  /**
   * Content; receives the highlight index, its setter, `close` (call after
   * choosing) and the DOM-id getter for options (for aria-activedescendant).
   */
  children: (
    highlight: number,
    setHighlight: (index: number) => void,
    close: () => void,
    optionId: (index: number) => string,
  ) => React.ReactNode
}

/**
 * A pill trigger opening an upward, keyboard-navigable listbox. Focus stays on
 * the trigger (`aria-activedescendant` marks the highlighted option); Escape
 * or a click away closes.
 */
function Dropdown({ ariaLabel, title, disabled, trigger, children }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const root = useRef<HTMLFieldSetElement>(null)
  const listId = useId()

  const close = () => setOpen(false)
  const optionId = (index: number) => `${listId}-option-${index}`

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) {
      root.current
        ?.querySelector(`[id="${listId}-option-${highlight}"]`)
        ?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [open, highlight, listId])

  const openWith = () => {
    setOpen(true)
    setHighlight(0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openWith()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Activate the highlighted option (marked via data attribute).
      e.preventDefault()
      const hit = root.current?.querySelector('[data-highlighted="true"]')
      ;(hit as HTMLElement | null)?.click()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const count = root.current?.querySelectorAll('[role="option"]').length ?? 0
      if (count === 0) return
      if (e.key === 'Home') setHighlight(0)
      else if (e.key === 'End') setHighlight(count - 1)
      else setHighlight((h) => (e.key === 'ArrowDown' ? (h + 1) % count : (h - 1 + count) % count))
    }
  }

  return (
    <fieldset
      ref={root}
      aria-label={`${ariaLabel} picker`}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        title={title}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(highlight) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openWith())}
        onKeyDown={onKeyDown}
        className="flex h-7 max-w-full min-w-0 cursor-pointer select-none items-center gap-1 rounded-md border border-edge bg-card px-2 text-xs text-ink transition-colors hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute bottom-full right-0 z-30 mb-1.5 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-edge-strong bg-card p-1 shadow-lg"
        >
          {children(highlight, setHighlight, close, optionId)}
        </div>
      )}
    </fieldset>
  )
}

interface DropdownOptionProps {
  id: string
  selected: boolean
  highlighted: boolean
  onHover(): void
  onClick(): void
  title?: string
  children: React.ReactNode
}

function DropdownOption({
  id,
  selected,
  highlighted,
  onHover,
  onClick,
  title,
  children,
}: DropdownOptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-highlighted={highlighted}
      title={title}
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-xs text-ink ${
        highlighted ? 'bg-active' : ''
      }`}
    >
      {children}
      {selected && (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="size-3.5 shrink-0 text-accent-text"
        >
          <path
            d="M3 8.5l3.2 3L13 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3 shrink-0 text-muted">
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
