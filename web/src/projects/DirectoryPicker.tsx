import type { DirEntry } from '@coja/shared/api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFsDirs, useFsHome } from '../api/hooks'
import { usePersistedState } from '../pr/usePersistedState'
import { Button, cn, Input, Spinner } from '../ui'

/**
 * The "Path to a local clone" input with a t3-style in-browser directory
 * browser. The text stays free-form — pasting an absolute path works as
 * always — while the popover lists the directories of the path being typed
 * (server-capped, prefix-filtered) to click through. Native folder pickers
 * cannot work here: browsers never reveal absolute paths, and the server's
 * git plumbing needs one.
 *
 * The input value is the single source of truth. `derive(value)` splits it
 * into the directory being listed and the prefix being typed:
 * `/Users/you/src` → list `/Users/you` filtered by `src`;
 * `/Users/you/src/` → list `/Users/you/src`. Clicking an entry appends it
 * with a trailing slash, i.e. descends; "Use this folder" picks the
 * directory currently listed.
 */

const LAST_PARENT_KEY = 'coja.lastProjectParent'

const isAbsoluteDir = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/')

/** `/a/b/c` → { dir: '/a/b', prefix: 'c' }; `/a/b/` → { dir: '/a/b', prefix: '' }; `''`/`rel` → null dir. */
function derive(value: string): { dir: string; prefix: string } {
  const slash = value.lastIndexOf('/')
  if (slash === -1) return { dir: '', prefix: value }
  const dir = slash === 0 ? '/' : value.slice(0, slash)
  return { dir, prefix: value.slice(slash + 1) }
}

const join = (dir: string, name: string): string => `${dir === '/' ? '' : dir}/${name}`

const parentOf = (dir: string): string | null => {
  const parent = dir.slice(0, dir.lastIndexOf('/'))
  if (parent === '') return dir === '/' ? null : '/'
  return parent
}

export interface DirectoryPickerProps {
  id: string
  value: string
  onChange(value: string): void
  invalid?: boolean
}

export function DirectoryPicker({ id, value, onChange, invalid }: DirectoryPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The listed directory/prefix, settled ~150 ms behind typing so keystrokes
  // do not fire a request each. Reset whenever the popover opens.
  const [settled, setSettled] = useState<{ dir: string; prefix: string } | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const [lastParent, setLastParent] = usePersistedState(LAST_PARENT_KEY, '', isAbsoluteDir)

  const home = useFsHome(open)
  const startDir = lastParent || home.data?.home || ''
  const derived = useMemo(() => derive(value), [value])
  const listing = useFsDirs(
    settled?.dir ?? '',
    settled?.prefix ?? '',
    open && settled !== null && settled.dir !== '',
  )

  useEffect(() => {
    if (!open) {
      setSettled(null)
      setHighlight(-1)
      return
    }
    // Opening lists the start directory (last-used parent, else home) unless
    // the input already names an absolute directory to continue from.
    const timer = setTimeout(() => {
      setSettled(derived.dir !== '' ? derived : { dir: startDir, prefix: '' })
    }, 150)
    return () => clearTimeout(timer)
  }, [open, derived, startDir])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [open])

  useEffect(() => {
    if (highlight < 0) return
    document.getElementById(`${id}-opt-${highlight}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, id])

  const commit = (path: string) => {
    const parent = parentOf(path)
    if (parent) setLastParent(parent)
    onChange(path)
    setOpen(false)
    inputRef.current?.focus()
  }

  const descend = (name: string) => {
    if (!settled) return
    onChange(`${join(settled.dir, name)}/`)
    setHighlight(-1)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    const entries = listing.data?.dirs ?? []
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (entries.length === 0) return
      setHighlight((current) => {
        if (current < 0) return event.key === 'ArrowDown' ? 0 : entries.length - 1
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1
        return (next + entries.length) % entries.length
      })
      return
    }
    if (event.key === 'Enter') {
      // While browsing, Enter belongs to the picker; only a closed popover
      // submits the Add-project form.
      event.preventDefault()
      if (entries.length === 0) return
      const entry = entries[highlight] ?? entries[0]
      if (!entry) return
      if (entry.hasGit) commit(join(settled?.dir ?? '', entry.name))
      else descend(entry.name)
    }
  }

  const listedDir = settled?.dir ?? ''
  const segments = listedDir === '/' ? [''] : listedDir.split('/').slice(1)

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-start gap-2">
        <Input
          ref={inputRef}
          id={id}
          name="path"
          className="font-mono"
          placeholder="/Users/you/src/my-repo"
          autoComplete="off"
          spellCheck={false}
          value={value}
          invalid={invalid}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-browser`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && highlight >= 0 && listing.data?.dirs[highlight]
              ? `${id}-opt-${highlight}`
              : undefined
          }
          onChange={(event) => {
            setHighlight(-1)
            onChange(event.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          aria-expanded={open}
          aria-controls={`${id}-browser`}
          onClick={() => setOpen((current) => !current)}
        >
          Browse…
        </Button>
      </div>

      {open && (
        <div
          id={`${id}-browser`}
          role="listbox"
          aria-label="Folders"
          className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-72 flex-col overflow-hidden rounded-md border border-edge-strong bg-card shadow-lg"
        >
          {settled && (
            <div className="flex items-center gap-1 overflow-x-auto border-edge border-b px-2 py-1.5 text-xs text-muted">
              <button
                type="button"
                className="shrink-0 rounded px-1 py-0.5 hover:bg-hover hover:text-ink disabled:opacity-40"
                disabled={parentOf(settled.dir) === null}
                aria-label="Up one folder"
                onClick={() => {
                  const parent = parentOf(settled.dir)
                  if (parent !== null) onChange(`${parent === '/' ? '/' : parent}/`)
                }}
              >
                ⤴
              </button>
              <span className="shrink-0 font-mono">/</span>
              {segments.map((segment, index) => {
                const target = `/${segments.slice(0, index + 1).join('/')}`
                return (
                  <button
                    key={`${target}-${segment}`}
                    type="button"
                    className="shrink-0 rounded px-1 py-0.5 font-mono hover:bg-hover hover:text-ink"
                    onClick={() => onChange(`${target === '/' ? '' : target}/`)}
                  >
                    {segment}
                  </button>
                )
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {listing.isPending && (
              <p className="flex items-center gap-2 px-3 py-2.5 text-muted text-sm">
                <Spinner size="sm" /> Listing folders…
              </p>
            )}
            {listing.isError && (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 break-words text-danger">
                  Could not list {listedDir || 'this folder'}.
                </span>
                {home.data && (
                  <Button size="sm" variant="ghost" onClick={() => onChange(`${home.data.home}/`)}>
                    Start from home
                  </Button>
                )}
              </div>
            )}
            {listing.data && listing.data.dirs.length === 0 && (
              <p className="px-3 py-2.5 text-muted text-sm">
                No folders match “{settled?.prefix}”.
              </p>
            )}
            {listing.data?.dirs.map((entry, index) => (
              <BrowserRow
                key={entry.name}
                entry={entry}
                highlighted={highlight === index}
                id={`${id}-opt-${index}`}
                onDescend={() => descend(entry.name)}
                onUse={() => commit(join(listedDir, entry.name))}
              />
            ))}
            {listing.data?.truncated && (
              <p className="border-edge border-t px-3 py-1.5 text-faint text-xs">
                Showing the first {listing.data.dirs.length} of {listing.data.total} folders — keep
                typing to narrow.
              </p>
            )}
          </div>

          {settled && settled.dir !== '' && (
            <div className="border-edge border-t p-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => commit(settled.dir)}
              >
                Use this folder
                <span className="ml-auto min-w-0 truncate font-mono text-muted">
                  {settled.dir === '/' ? '/' : settled.dir.split('/').pop()}
                </span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BrowserRow({
  entry,
  highlighted,
  id,
  onDescend,
  onUse,
}: {
  entry: DirEntry
  highlighted: boolean
  id: string
  onDescend(): void
  onUse(): void
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={highlighted}
      tabIndex={-1}
      onClick={onDescend}
      onKeyDown={(event) => {
        // Focus stays on the combobox input (aria-activedescendant drives the
        // highlight); this mirrors the click if the row is activated directly.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onDescend()
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
        highlighted ? 'bg-active text-ink' : 'hover:bg-hover',
      )}
    >
      <FolderIcon />
      <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
      {entry.hasGit && (
        <span
          className="shrink-0 rounded-full border border-edge px-1.5 text-[11px] text-muted"
          title="Contains a .git folder"
        >
          repo
        </span>
      )}
      {entry.hasGit && (
        <button
          type="button"
          className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-ink"
          onClick={(event) => {
            event.stopPropagation()
            onUse()
          }}
        >
          Use
        </button>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 shrink-0 text-muted">
      <path
        d="M1.5 4.2c0-.66.54-1.2 1.2-1.2h3l1.4 1.6h6.2c.66 0 1.2.54 1.2 1.2v6c0 .66-.54 1.2-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}
