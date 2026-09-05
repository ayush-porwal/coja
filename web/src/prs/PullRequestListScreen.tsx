import type { Actor, MyReviewState, PullRequestSummary } from '@coja/shared/api'
import { Link, useParams } from 'react-router'
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

/** Open PRs of one project (design §2). Clicking a title opens the review screen. */
export function PullRequestListScreen() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const project = useProject(projectId)
  const prs = usePullRequests(projectId)

  let crumb = '…'
  if (project.data) crumb = `${project.data.owner}/${project.data.repo}`
  else if (project.isError) crumb = 'Unknown project'

  return (
    <AppShell breadcrumb={<span className="truncate font-medium">{crumb}</span>}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Open pull requests</h1>
        <div className="flex items-center gap-2">
          {prs.data && prs.data.length > 0 && (
            <span className="text-xs text-muted">{prs.data.length} open</span>
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
        ) : prs.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge-strong bg-card px-4 py-10 text-center text-sm text-muted">
            No open pull requests
          </p>
        ) : (
          <ul className="divide-y divide-edge rounded-lg border border-edge bg-card">
            {prs.data.map((pr) => (
              <PullRequestRow key={pr.id} pr={pr} projectId={projectId} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
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
