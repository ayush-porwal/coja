import {
  type Actor,
  type MyReviewState,
  type PrListFilter,
  type PullRequestPage,
  type PullRequestSummary,
  parsePrQuery,
  tokenizePrQuery,
} from '@coja/shared/api'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { isPrFilterEmpty, useProject, usePullRequests } from '../api/hooks'
import { formatRelativeTime } from '../lib/time'
import {
  AppShell,
  Badge,
  type BadgeTone,
  Button,
  cn,
  ErrorNotice,
  focusRing,
  SkeletonRows,
  Spinner,
} from '../ui'

const REVIEW_BADGES: Record<MyReviewState, { label: string; tone: BadgeTone } | null> = {
  none: null,
  pending: { label: 'Pending review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  changes_requested: { label: 'Changes requested', tone: 'red' },
  commented: { label: 'Commented', tone: 'neutral' },
}

/**
 * Open PRs of one project (design §2), paginated like GitHub: numbered pages
 * of 100 in the URL (`?page=3`), so reload and back/forward keep the page.
 * Clicking a title opens the review screen.
 */
export function PullRequestListScreen() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const project = useProject(projectId)
  const [searchParams, setSearchParams] = useSearchParams()
  const parsed = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const requested = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  // Filters live in the URL as one GitHub-style query string (?q=author:alice
  // fix login), so a filtered view is shareable and survives reload/back.
  // Anything that isn't a known qualifier is free text: title tokens, or a
  // bare hex SHA that GitHub matches by commit.
  const query = param(searchParams, 'q')
  const filter: PrListFilter = query ? parsePrQuery(query) : {}
  const filtered = !isPrFilterEmpty(filter)
  const prs = usePullRequests(projectId, requested, filter)
  const data = prs.data as PullRequestPage | undefined

  // Any filter change restarts at page 1.
  const applyQuery = (raw: string) => {
    const trimmed = raw.trim()
    setSearchParams(trimmed ? { q: trimmed } : {})
  }

  const setPage = (next: number) => {
    const params: Record<string, string> = {}
    if (next > 1) params.page = String(next)
    if (query) params.q = query
    setSearchParams(params)
  }

  let crumb = '…'
  if (project.data) crumb = `${project.data.owner}/${project.data.repo}`
  else if (project.isError) crumb = 'Unknown project'

  return (
    <AppShell breadcrumb={<span className="truncate font-medium">{crumb}</span>}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Open pull requests</h1>
        <div className="flex items-center gap-2">
          {data && data.total > 0 && (
            <span className="text-xs text-muted">
              {data.total} {filtered ? (data.total === 1 ? 'match' : 'matches') : 'open'}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="Refresh pull requests"
            title="Refresh"
            disabled={prs.isFetching}
            onClick={() => void prs.refetch()}
          >
            {prs.isFetching ? <Spinner size="sm" /> : <RefreshIcon />}
          </Button>
        </div>
      </div>

      {project.isError && (
        <ErrorNotice
          className="mt-4"
          title="Couldn't load the project"
          message={project.error.message}
          onRetry={() => void project.refetch()}
          retrying={project.isFetching}
        />
      )}

      <FilterBar query={query ?? ''} onApply={applyQuery} />

      <div className="mt-4">
        {prs.isPending ? (
          <SkeletonRows rows={5} label="Loading pull requests" />
        ) : prs.isError ? (
          <ErrorNotice
            title="Couldn't load pull requests"
            message={prs.error.message}
            onRetry={() => void prs.refetch()}
            retrying={prs.isFetching}
          />
        ) : !data?.items?.length ? (
          <div className="rounded-lg border border-dashed border-edge-strong bg-card px-4 py-10 text-center text-sm text-muted">
            {filtered ? (
              <>
                <p>No pull requests match these filters.</p>
                <button
                  type="button"
                  onClick={() => applyQuery('')}
                  className="mt-2 cursor-pointer rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-ink hover:bg-hover"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <p>No open pull requests</p>
            )}
          </div>
        ) : (
          <div>
            <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-card shadow-xs">
              {data.items.map((pr) => (
                <PullRequestRow key={pr.id} pr={pr} projectId={projectId} />
              ))}
            </ul>
            <Pager page={data} onPage={setPage} refreshing={prs.isFetching} />
          </div>
        )}
      </div>
    </AppShell>
  )
}

/**
 * GitHub-style pager: prev/next, a windowed number line (1 … n-1 n n+1 … last)
 * and "Showing X–Y of N". Buttons are links-like controls; the current page
 * is marked `aria-current`.
 */
function Pager({
  page,
  onPage,
  refreshing,
}: {
  page: PullRequestPage
  onPage(next: number): void
  refreshing: boolean
}) {
  // One page only: the header count already says how many are open — no footer.
  if (page.totalPages <= 1) return null
  const from = (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)
  return (
    <nav
      aria-label="Pull request pages"
      className="mt-3 flex flex-wrap items-center justify-center gap-1 text-xs"
    >
      <PagerButton
        disabled={page.page <= 1 || refreshing}
        onClick={() => onPage(page.page - 1)}
        label="Previous page"
      >
        ←
      </PagerButton>
      {windowedPages(page.page, page.totalPages).map((entry, index) =>
        entry === '…' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the gap marker is purely positional; entries are stable
          <span key={`gap-${index}`} className="px-1 text-faint" aria-hidden="true">
            …
          </span>
        ) : (
          <PagerButton
            key={entry}
            active={entry === page.page}
            disabled={refreshing}
            onClick={() => onPage(entry)}
            label={`Page ${entry}`}
          >
            {entry}
          </PagerButton>
        ),
      )}
      <PagerButton
        disabled={page.page >= page.totalPages || refreshing}
        onClick={() => onPage(page.page + 1)}
        label="Next page"
      >
        →
      </PagerButton>
      <p className="ml-2 text-muted" aria-live="polite">
        Showing {from}–{to} of {page.total}
      </p>
    </nav>
  )
}

function PagerButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick(): void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`min-w-7 cursor-pointer rounded-md border px-1.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-edge bg-card text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * 1 … around-current … last, GitHub-style: always the first and last page,
 * the window around the current one, and ellipses for gaps wider than one.
 */
export function windowedPages(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const entries = new Set<number>([1, totalPages, current - 1, current, current + 1])
  const sorted = [...entries].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let previous = 0
  for (const n of sorted) {
    if (n - previous > 1) out.push('…')
    out.push(n)
    previous = n
  }
  return out
}

/** `1200` → `1.2k`, matching GitHub's diff-stat shorthand. */
function shortCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
}

function PullRequestRow({ pr, projectId }: { pr: PullRequestSummary; projectId: string }) {
  const review = REVIEW_BADGES[pr.myReviewState]
  const updated = new Date(pr.updatedAt)
  return (
    <li className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-hover">
      <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-faint">#{pr.number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/p/${projectId}/pr/${pr.number}`}
            className={cn(
              'truncate rounded-sm text-sm font-medium text-ink group-hover:underline',
              focusRing,
            )}
          >
            {pr.title}
          </Link>
          {pr.isDraft && <Badge>Draft</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Avatar actor={pr.author} />
            {pr.author.login}
          </span>
          <span
            className="inline-flex min-w-0 items-center gap-1"
            title={`${pr.headRefName} → ${pr.baseRefName}`}
          >
            <BranchIcon />
            <span className="truncate font-mono">
              {pr.headRefName} <span className="text-faint">→</span> {pr.baseRefName}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon />
            <time
              dateTime={pr.updatedAt}
              title={Number.isNaN(updated.getTime()) ? undefined : updated.toLocaleString()}
            >
              updated {formatRelativeTime(pr.updatedAt)}
            </time>
          </span>
          <span
            className="font-mono"
            title={`${pr.changedFiles} changed ${pr.changedFiles === 1 ? 'file' : 'files'}`}
          >
            <span className="text-ok">+{shortCount(pr.additions)}</span>{' '}
            <span className="text-danger">−{shortCount(pr.deletions)}</span>
          </span>
        </div>
      </div>
      {review && (
        <Badge tone={review.tone} className="shrink-0">
          {review.label}
        </Badge>
      )}
    </li>
  )
}

function BranchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-3.5 shrink-0 text-faint"
    >
      <circle cx="4.5" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4.5" cy="12.5" r="1.75" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11.5" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.5 5.25v5.5M11.5 5.25c0 2.5-2 3-4.5 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-3.5 shrink-0 text-faint"
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function Avatar({ actor }: { actor: Actor }) {
  if (actor.avatarUrl) {
    return (
      <img
        src={actor.avatarUrl}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        className="size-6 rounded-full bg-active"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 items-center justify-center rounded-full bg-active text-[10px] font-semibold uppercase text-muted"
    >
      {actor.login.slice(0, 1)}
    </span>
  )
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" />
      <path d="M13.5 1.75v2.8h-2.8" />
    </svg>
  )
}

/** One editable query with syntax highlighting driven by the shared parser. */
function FilterBar({ query, onApply }: { query: string; onApply(raw: string): void }) {
  const [draft, setDraft] = useState(query)
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
    if (!composing.current)
      timer.current = setTimeout(() => {
        if (value.trim() !== query) onApply(value)
      }, 300)
  }
  if (previousQuery !== query) {
    cancel()
    setPreviousQuery(query)
    // Keep whitespace and the caret when acknowledging our own edit.
    if (draft.trim() !== query) setDraft(query)
  }
  const tokens = tokenizePrQuery(draft)
  const highlights = []
  let offset = 0
  for (const token of tokens) {
    highlights.push(<span key={`space-${token.start}`}>{draft.slice(offset, token.start)}</span>)
    highlights.push(
      <span
        key={token.start}
        className={token.field ? 'rounded-sm bg-accent-soft text-accent' : undefined}
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
        if (draft.trim() !== query) onApply(draft)
      }}
    >
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-card px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
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
            value={draft}
            onChange={(event) => edit(event.target.value)}
            onScroll={(event) => {
              if (overlay.current) overlay.current.scrollLeft = event.currentTarget.scrollLeft
            }}
            onCompositionStart={() => {
              composing.current = true
              cancel()
            }}
            onCompositionEnd={(event) => {
              composing.current = false
              edit(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
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
      <p id="pr-filter-help" className="mt-2 text-xs leading-5 text-muted">
        Search titles or a commit SHA. Filters: <code>author:login</code>, <code>head:branch</code>,{' '}
        <code>base:branch</code>, <code>is:draft</code>, <code>is:ready</code>,{' '}
        <code>draft:true/false</code>.
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

function param(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim()
  return value ? value : undefined
}
