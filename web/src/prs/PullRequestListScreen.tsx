import type { Actor, MyReviewState, PullRequestPage, PullRequestSummary } from '@coja/shared/api'
import { Link, useParams, useSearchParams } from 'react-router'
import { useProject, usePullRequests } from '../api/hooks'
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
  const prs = usePullRequests(projectId, requested)
  const data = prs.data as PullRequestPage | undefined

  const setPage = (next: number) => {
    setSearchParams(next === 1 ? {} : { page: String(next) })
  }

  let crumb = '…'
  if (project.data) crumb = `${project.data.owner}/${project.data.repo}`
  else if (project.isError) crumb = 'Unknown project'

  return (
    <AppShell breadcrumb={<span className="truncate font-medium">{crumb}</span>}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Open pull requests</h1>
        <div className="flex items-center gap-2">
          {data && data.total > 0 && <span className="text-xs text-muted">{data.total} open</span>}
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
          <p className="rounded-lg border border-dashed border-edge-strong bg-card px-4 py-10 text-center text-sm text-muted">
            No open pull requests
          </p>
        ) : (
          <div
            className={
              prs.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'
            }
          >
            <ul className="divide-y divide-edge rounded-lg border border-edge bg-card">
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

function PullRequestRow({ pr, projectId }: { pr: PullRequestSummary; projectId: string }) {
  const review = REVIEW_BADGES[pr.myReviewState]
  const updated = new Date(pr.updatedAt)
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted">#{pr.number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/p/${projectId}/pr/${pr.number}`}
            className={cn('truncate rounded-sm text-sm font-medium hover:underline', focusRing)}
          >
            {pr.title}
          </Link>
          {pr.isDraft && <Badge>Draft</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Avatar actor={pr.author} />
            {pr.author.login}
          </span>
          <span className="font-mono">
            {pr.headRefName} → {pr.baseRefName}
          </span>
          <span>
            updated{' '}
            <time
              dateTime={pr.updatedAt}
              title={Number.isNaN(updated.getTime()) ? undefined : updated.toLocaleString()}
            >
              {formatRelativeTime(pr.updatedAt)}
            </time>
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
