import type { FetchStatus, PullRequestDetail } from '@coja/shared/api'
import { Link } from 'react-router'
import { Avatar } from './Avatar'
import type { DiffStyle } from './types'

interface TopBarProps {
  projectId: string
  number: number
  detail: PullRequestDetail | undefined
  fetchStatus: FetchStatus | undefined
  fetchError: Error | null
  onRetryFetch(): void
  diffStyle: DiffStyle
  onDiffStyleChange(style: DiffStyle): void
  aiOpen: boolean
  onToggleAi(): void
  onOpenReview(): void
}

const iconButton =
  'rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800'

export function TopBar({
  projectId,
  number,
  detail,
  fetchStatus,
  fetchError,
  onRetryFetch,
  diffStyle,
  onDiffStyleChange,
  aiOpen,
  onToggleAi,
  onOpenReview,
}: TopBarProps) {
  const pendingCount = detail?.pendingReview?.commentCount ?? 0
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-zinc-200 border-b bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <Link
        to={`/p/${encodeURIComponent(projectId)}`}
        className="shrink-0 rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        aria-label="Back to pull requests"
      >
        ← PRs
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1
          className="truncate font-semibold text-zinc-900 dark:text-zinc-50"
          title={detail?.title}
        >
          {detail?.title ?? 'Loading pull request…'}
        </h1>
        <span className="shrink-0 text-zinc-400">#{number}</span>
        {detail?.isDraft && (
          <span className="shrink-0 rounded-full border border-zinc-300 px-2 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
            Draft
          </span>
        )}
        {detail && (
          <>
            <span className="shrink-0 text-zinc-300 dark:text-zinc-700">·</span>
            <span className="flex shrink-0 items-center gap-1 text-zinc-600 dark:text-zinc-300">
              <Avatar actor={detail.author} size={18} />
              {detail.author.login}
            </span>
            <span className="shrink-0 text-zinc-300 dark:text-zinc-700">·</span>
            <span className="hidden min-w-0 items-center gap-1 truncate font-mono text-xs text-zinc-600 md:flex dark:text-zinc-300">
              <span className="truncate">{detail.headRefName}</span>
              <span aria-hidden="true">→</span>
              <span className="truncate">{detail.baseRefName}</span>
            </span>
            <a
              href={detail.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-blue-600 text-xs hover:underline dark:text-blue-400"
            >
              Open on GitHub ↗
            </a>
          </>
        )}
      </div>

      <FetchPill status={fetchStatus} error={fetchError} onRetry={onRetryFetch} />

      <fieldset className="flex shrink-0 overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-600">
        <legend className="sr-only">Diff layout</legend>
        {(['unified', 'split'] as const).map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={diffStyle === style}
            onClick={() => onDiffStyleChange(style)}
            className={`px-2 py-1 font-medium ${
              diffStyle === style
                ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
            }`}
          >
            {style === 'unified' ? 'Stacked' : 'Split'}
          </button>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={onToggleAi}
        aria-pressed={aiOpen}
        className={`${iconButton} shrink-0 ${aiOpen ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
        title={aiOpen ? 'Hide AI panel' : 'Show AI panel'}
      >
        AI
      </button>

      <button
        type="button"
        onClick={onOpenReview}
        disabled={!detail}
        className="flex shrink-0 items-center gap-1.5 rounded bg-green-600 px-3 py-1 font-semibold text-white text-xs hover:bg-green-700 disabled:opacity-50"
      >
        Review
        {pendingCount > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[11px] leading-4">
            {pendingCount}
            <span className="sr-only"> pending comments</span>
          </span>
        )}
        <span aria-hidden="true">▾</span>
      </button>
    </header>
  )
}

interface FetchPillProps {
  status: FetchStatus | undefined
  error: Error | null
  onRetry(): void
}

const pillBase = 'flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs'

function FetchPill({ status, error, onRetry }: FetchPillProps) {
  if (error || status?.state === 'error') {
    const message = error?.message ?? status?.error ?? 'Fetch failed'
    return (
      <span
        className={`${pillBase} max-w-[28rem] border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300`}
        role="status"
      >
        <span className="truncate" title={message}>
          {message}
        </span>
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      </span>
    )
  }
  if (status?.state === 'ready') {
    return (
      <span
        className={`${pillBase} border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300`}
        role="status"
        title={status.headOid ? `head ${status.headOid.slice(0, 7)}` : undefined}
      >
        Ready
      </span>
    )
  }
  return (
    <span
      className={`${pillBase} border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300`}
      role="status"
    >
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"
        aria-hidden="true"
      />
      Fetching objects…
    </span>
  )
}
