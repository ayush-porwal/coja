import {
  type PrListState,
  type PullRequestSummary,
  type RepositoryContributor,
  tokenizePrQuery,
} from '@coja/shared/api'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn, focusRing } from '../ui'
import {
  completeQuery,
  type QuerySuggestion,
  querySuggestions,
  replaceQueryState,
} from './querySuggestions'

/** One editable query with syntax highlighting driven by the shared parser. */
export function FilterBar({
  query,
  onApply,
  items,
  contributors,
  state,
}: {
  query: string
  onApply(raw: string): void
  items: PullRequestSummary[] | undefined
  state: PrListState
  contributors?: RepositoryContributor[]
}) {
  const [draft, setDraft] = useState(query)
  const [caret, setCaret] = useState(query.length)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [values, setValues] = useState<QuerySuggestion[]>([])
  const listId = useId()
  useEffect(() => {
    if (!items) return
    setValues((previous) => {
      const next = new Map(previous.map((s) => [s.value, s]))
      for (const pr of items) {
        for (const [field, value] of [
          ['author', pr.author.login],
          ['base', pr.baseRefName],
          ['head', pr.headRefName],
        ]) {
          if (!value) continue
          const encoded = /[\s"\\]/.test(value) ? JSON.stringify(value) : value
          const key = `${field}:${encoded}`
          next.set(key, {
            value: key,
            description:
              field === 'author' ? 'Author in loaded results' : 'Branch in loaded results',
          })
        }
      }
      return [...next.values()].slice(-300)
    })
  }, [items])
  const rankedValues = useMemo(() => {
    const ranked = [...(contributors ?? [])].sort((a, b) => b.contributions - a.contributions)
    const seen = new Set<string>()
    return [
      ...ranked.map((c) => ({
        value: `author:${c.login}`,
        description: `${c.contributions.toLocaleString()} commits`,
      })),
      ...values,
    ].filter((s) => {
      const key = s.value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [contributors, values])
  const suggestions = useMemo(
    () => querySuggestions(draft, caret, rankedValues),
    [draft, caret, rankedValues],
  )
  const expanded = open && suggestions.length > 0
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded || active < 0) return
    const list = listRef.current
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !option) return
    const top = option.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (top < 0) list.scrollTop += top
    else if (top + option.offsetHeight > list.clientHeight)
      list.scrollTop += top + option.offsetHeight - list.clientHeight
  }, [active, expanded])
  const [previousQuery, setPreviousQuery] = useState(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const edit = (value: string) => {
    cancel()
    setDraft(value)
    setActive(-1)
    setOpen(!composing.current)
    // Do not search for an unfinished qualifier while the user is completing it.
    if (
      tokenizePrQuery(value).some(
        (t) => !t.field && /^(is|state|draft|author|base|head):$/i.test(t.raw),
      )
    )
      return
    if (!composing.current)
      timer.current = setTimeout(() => {
        if (value.trim() !== query) onApply(value)
      }, 300)
  }
  if (previousQuery !== query) {
    cancel()
    setPreviousQuery(query)
    // Keep whitespace and the caret when acknowledging our own edit.
    if (draft.trim() !== query) {
      setDraft(query)
      setCaret(query.length)
      setOpen(false)
      setActive(-1)
    }
  }
  const choose = (suggestion: QuerySuggestion) => {
    const next = completeQuery(draft, caret, suggestion.value)
    edit(next.query)
    setCaret(next.caret)
    setOpen(suggestion.value.endsWith(':'))
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const tokens = tokenizePrQuery(draft)
  const highlights = []
  let offset = 0
  for (const token of tokens) {
    highlights.push(<span key={`space-${token.start}`}>{draft.slice(offset, token.start)}</span>)
    highlights.push(
      <span
        key={token.start}
        className={token.field ? 'rounded-sm bg-accent-soft text-accent-text' : undefined}
      >
        {token.raw}
      </span>,
    )
    offset = token.end
  }
  highlights.push(<span key="end">{draft.slice(offset)}</span>)

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault()
        cancel()
        setOpen(false)
        if (draft.trim() !== query) onApply(draft)
      }}
    >
      <div className="relative">
        <div className="relative flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-card px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <SearchIcon />
          <div className="relative min-w-0 flex-1">
            <div
              ref={overlay}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-mono text-sm leading-6 text-ink"
            >
              {highlights}
            </div>
            <input
              ref={input}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-activedescendant={
                expanded && active >= 0 && active < suggestions.length
                  ? `${listId}-${active}`
                  : undefined
              }
              value={draft}
              onChange={(event) => {
                setCaret(event.target.selectionStart ?? event.target.value.length)
                edit(event.target.value)
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? draft.length)}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onScroll={(event) => {
                if (overlay.current) overlay.current.scrollLeft = event.currentTarget.scrollLeft
              }}
              onCompositionStart={() => {
                composing.current = true
                cancel()
                setOpen(false)
              }}
              onCompositionEnd={(event) => {
                composing.current = false
                setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                edit(event.currentTarget.value)
              }}
              onKeyDown={(event) => {
                if (composing.current || event.nativeEvent.isComposing) return
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
                  event.preventDefault()
                  setOpen(true)
                  setActive((current) =>
                    event.key === 'ArrowDown'
                      ? (current + 1) % suggestions.length
                      : current <= 0
                        ? suggestions.length - 1
                        : current - 1,
                  )
                } else if (
                  event.key === 'Enter' &&
                  expanded &&
                  active >= 0 &&
                  suggestions[active]
                ) {
                  event.preventDefault()
                  choose(suggestions[active])
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  if (expanded) {
                    setOpen(false)
                    setActive(-1)
                    return
                  }
                  cancel()
                  setDraft(query)
                }
              }}
              aria-label="Filter pull requests"
              aria-describedby="pr-filter-help"
              placeholder="Filter pull requests…"
              spellCheck={false}
              autoComplete="off"
              className="relative block h-6 w-full min-w-0 appearance-none border-0 bg-transparent p-0 font-mono text-sm leading-6 text-transparent caret-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          {draft && (
            <button
              type="button"
              aria-label="Clear query"
              onClick={() => {
                cancel()
                setDraft('')
                setCaret(0)
                setActive(-1)
                onApply('')
                input.current?.focus()
              }}
              className={cn(
                'shrink-0 cursor-pointer rounded px-1 text-muted hover:text-ink',
                focusRing,
              )}
            >
              ×
            </button>
          )}
          <button
            type="submit"
            className={cn(
              'shrink-0 cursor-pointer rounded border border-edge px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-ink',
              focusRing,
            )}
          >
            Search
          </button>
        </div>
        {expanded && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-edge bg-card shadow-lg">
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Filter suggestions"
              className="max-h-80 overflow-y-auto overscroll-contain py-1"
            >
              {suggestions.map((suggestion, index) => (
                <div key={suggestion.value} role="presentation">
                  <button
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(suggestion)}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-hover',
                      index === active && 'bg-active',
                    )}
                  >
                    <span className="truncate font-mono text-ink">{suggestion.value}</span>
                    <span className="text-right text-xs text-muted">{suggestion.description}</span>
                  </button>
                </div>
              ))}
            </div>
            <p className="border-t border-edge px-3 py-2 text-xs text-muted">
              ↑ ↓ to browse · Enter to insert · Esc to dismiss
            </p>
          </div>
        )}
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-1 border-0 p-0" aria-label="Pull request state">
        {(['open', 'closed', 'merged', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={state === value}
            onClick={() => {
              cancel()
              setOpen(false)
              onApply(replaceQueryState(draft, value))
            }}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1 text-xs font-medium capitalize',
              focusRing,
              state === value
                ? 'bg-accent-soft text-accent-text'
                : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </fieldset>
      <p id="pr-filter-help" className="mt-2 text-xs leading-5 text-muted">
        Search titles or a commit SHA. Type <code>is:</code>, <code>author:</code>,{' '}
        <code>base:</code>, or <code>head:</code> for suggestions. Closed includes merged PRs.
      </p>
    </form>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 shrink-0 text-muted">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
