import type { FetchStatus, PullRequestDetail } from '@coja/shared/api'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Avatar } from './Avatar'
import { PanelToggles } from './PanelToggles'
import type { DiffStyle } from './types'

interface TopBarProps {
  projectId: string
  number: number
  detail: PullRequestDetail | undefined
  fetchStatus: FetchStatus | undefined
  fetchError: Error | null
  onRetryFetch(): void
  /** What the center pane shows: the PR conversation, or the diff in `diffStyle`. */
  view: 'conversation' | 'changes'
  diffStyle: DiffStyle
  /** Selects the Conversation view (center pane shows the overview). */
  onConversation(): void
  /** Selects the Changes view with the given diff layout. */
  onChanges(style: DiffStyle): void
  treeOpen: boolean
  onToggleTree(): void
  aiOpen: boolean
  onToggleAi(): void
  /** Comment threads in the PR — badge on the collapsed tree toggle. */
  threadCount: number
  /** Context chips waiting in the AI composer — badge on the collapsed AI toggle. */
  chipCount: number
  onOpenReview(): void
}

export function TopBar({
  projectId,
  number,
  detail,
  fetchStatus,
  fetchError,
  onRetryFetch,
  view,
  diffStyle,
  onConversation,
  onChanges,
  treeOpen,
  onToggleTree,
  aiOpen,
  onToggleAi,
  threadCount,
  chipCount,
  onOpenReview,
}: TopBarProps) {
  const pendingCount = detail?.pendingReview?.commentCount ?? 0
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-edge border-b bg-chrome px-2.5 py-2 text-sm">
      <PanelToggles
        treeOpen={treeOpen}
        onToggleTree={onToggleTree}
        aiOpen={aiOpen}
        onToggleAi={onToggleAi}
        threadCount={threadCount}
        chipCount={chipCount}
      />

      <div className="mx-1 h-5 w-px shrink-0 bg-edge" aria-hidden="true" />

      <Link
        to={`/p/${encodeURIComponent(projectId)}`}
        className="shrink-0 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-ink"
        aria-label="Back to pull requests"
      >
        ← PRs
      </Link>

      <div className="order-first flex min-w-0 basis-full items-center gap-2 px-1 lg:order-none lg:flex-1 lg:basis-0">
        <h1 className="truncate font-semibold text-ink" title={detail?.title}>
          {detail?.title ?? 'Loading pull request…'}
        </h1>
        <span className="shrink-0 text-faint">#{number}</span>
        {detail?.isDraft && (
          <span className="shrink-0 rounded-full border border-edge px-2 text-xs text-muted">
            Draft
          </span>
        )}
        {detail && (
          <>
            <span className="hidden max-w-36 min-w-0 items-center gap-1.5 text-muted sm:flex">
              <Avatar actor={detail.author} size={18} />
              <span className="truncate" title={detail.author.login}>
                {detail.author.login}
              </span>
            </span>
            <span className="hidden min-w-0 items-center gap-1 truncate rounded bg-active px-1.5 py-0.5 font-mono text-xs text-muted md:flex">
              <span className="truncate">{detail.headRefName}</span>
              <span aria-hidden="true" className="text-faint">
                →
              </span>
              <span className="truncate">{detail.baseRefName}</span>
            </span>
            <a
              href={detail.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs text-accent-text hover:underline"
            >
              GitHub ↗
            </a>
          </>
        )}
      </div>

      <FetchPill status={fetchStatus} error={fetchError} onRetry={onRetryFetch} />

      <fieldset className="flex shrink-0 items-center overflow-hidden rounded border border-edge-strong">
        <legend className="sr-only">View</legend>
        <SegButton
          active={view === 'conversation'}
          onClick={onConversation}
          label="Conversation"
          title="Conversation — description, commits and discussion"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
            <path
              d="M2.5 3.5h11a.9.9 0 0 1 .9.9v6.2a.9.9 0 0 1-.9.9H8.4L5.2 14v-2.5H2.5a.9.9 0 0 1-.9-.9V4.4a.9.9 0 0 1 .9-.9Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </SegButton>
        <SegButton
          active={view === 'changes' && diffStyle === 'unified'}
          onClick={() => onChanges('unified')}
          label="Changes, stacked"
          title="Changes, stacked — every file in one scroll"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-4">
            <rect x="2" y="3" width="12" height="4.4" rx="1" />
            <rect x="2" y="9" width="12" height="4.4" rx="1" />
          </svg>
        </SegButton>
        <SegButton
          active={view === 'changes' && diffStyle === 'split'}
          onClick={() => onChanges('split')}
          label="Changes, split"
          title="Changes, split — old and new side by side"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-4">
            <rect x="2" y="3" width="5" height="10.4" rx="1" />
            <rect x="9" y="3" width="5" height="10.4" rx="1" />
          </svg>
        </SegButton>
      </fieldset>

      <button
        type="button"
        onClick={onOpenReview}
        disabled={!detail}
        className="flex shrink-0 items-center gap-1.5 rounded bg-accent px-3 py-1 font-semibold text-xs text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        Review
        {pendingCount > 0 && (
          <span className="rounded-full bg-accent-ink/15 px-1.5 text-xs leading-4">
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
        className={`${pillBase} border-danger max-w-[min(28rem,calc(100vw-2rem))] bg-danger-soft text-danger-text`}
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
        className={`${pillBase} border-ok bg-ok-soft text-ok-text`}
        role="status"
        title={status.headOid ? `head ${status.headOid.slice(0, 7)}` : undefined}
      >
        Ready
      </span>
    )
  }
  return (
    <span className={`${pillBase} border-edge text-muted`} role="status">
      <span
        className="inline-block h-2 w-2 motion-safe:animate-pulse rounded-full bg-caution"
        aria-hidden="true"
      />
      Fetching objects…
    </span>
  )
}

function SegButton({
  active,
  onClick,
  label,
  title,
  children,
}: {
  active: boolean
  onClick(): void
  /** Accessible name; the button itself is icon-only (Zed-style). */
  label: string
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={`flex h-7 w-8 items-center justify-center ${
        active ? 'bg-ink text-canvas' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
