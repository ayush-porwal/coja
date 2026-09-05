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
    <AppShell
      breadcrumb={<span className="truncate font-medium">{crumb}</span>}
      actions={
        <Button size="sm" onClick={() => void prs.refetch()} loading={prs.isFetching}>
          Refresh
        </Button>
      }
    >
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Open pull requests</h1>
        {prs.data && prs.data.length > 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{prs.data.length} open</span>
        )}
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
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            No open pull requests
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
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
      <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
        #{pr.number}
      </span>
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
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
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
        className="size-6 rounded-full bg-zinc-200 dark:bg-zinc-700"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
    >
      {actor.login.slice(0, 1)}
    </span>
  )
}
