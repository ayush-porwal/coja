import type { Commit, ConversationItem, PullRequestDetail, ReviewState } from '@coja/shared/api'
import { Avatar } from './Avatar'
import { formatAbsolute, formatRelative } from './format'

interface OverviewProps {
  detail: PullRequestDetail
}

const sectionTitle = 'mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500'

/** PR description, commit list and the top-level (non-diff) conversation. */
export function Overview({ detail }: OverviewProps) {
  const conversation = sortConversation(detail.conversation)
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <header className="mb-6">
        <h1 className="font-semibold text-xl leading-snug text-zinc-900 dark:text-zinc-50">
          {detail.title} <span className="font-normal text-zinc-400">#{detail.number}</span>
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {detail.isDraft && (
            <span className="rounded-full border border-zinc-300 px-2 text-xs dark:border-zinc-600">
              Draft
            </span>
          )}
          <Avatar actor={detail.author} size={18} />
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {detail.author.login}
          </span>
          <span>wants to merge</span>
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
            {detail.headRefName}
          </code>
          <span>into</span>
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
            {detail.baseRefName}
          </code>
          <span>·</span>
          <time dateTime={detail.createdAt} title={formatAbsolute(detail.createdAt)}>
            opened {formatRelative(detail.createdAt)}
          </time>
          <span>·</span>
          <span>
            {detail.changedFiles} {detail.changedFiles === 1 ? 'file' : 'files'},{' '}
            <span className="text-green-700 dark:text-green-400">+{detail.additions}</span>{' '}
            <span className="text-red-700 dark:text-red-400">−{detail.deletions}</span>
          </span>
        </p>
      </header>

      <section aria-labelledby="overview-description" className="mb-8">
        <h2 id="overview-description" className={sectionTitle}>
          Description
        </h2>
        {detail.bodyHTML.trim() ? (
          <div
            className="coja-markdown rounded-md border border-zinc-200 p-4 dark:border-zinc-700"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHTML is GitHub-sanitized markdown
            dangerouslySetInnerHTML={{ __html: detail.bodyHTML }}
          />
        ) : (
          <p className="text-sm text-zinc-500 italic">No description provided.</p>
        )}
      </section>

      <section aria-labelledby="overview-commits" className="mb-8">
        <h2 id="overview-commits" className={sectionTitle}>
          Commits <span className="font-normal">({detail.commits.length})</span>
        </h2>
        {detail.commits.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No commits.</p>
        ) : (
          <ol className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
            {detail.commits.map((commit) => (
              <li key={commit.oid}>
                <CommitRow commit={commit} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="overview-conversation">
        <h2 id="overview-conversation" className={sectionTitle}>
          Conversation <span className="font-normal">({conversation.length})</span>
        </h2>
        {conversation.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No conversation yet.</p>
        ) : (
          <ol className="space-y-3">
            {conversation.map((item) => (
              <li key={item.id}>
                <ConversationEntry item={item} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function CommitRow({ commit }: { commit: Commit }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2 text-sm">
      <a
        href={commit.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 font-mono text-blue-600 text-xs hover:underline dark:text-blue-400"
      >
        {commit.abbreviatedOid}
      </a>
      <span
        className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200"
        title={commit.messageBody || undefined}
      >
        {commit.messageHeadline}
      </span>
      <span className="shrink-0 text-xs text-zinc-500">
        {commit.authorLogin ?? commit.authorName} ·{' '}
        <time dateTime={commit.committedDate} title={formatAbsolute(commit.committedDate)}>
          {formatRelative(commit.committedDate)}
        </time>
      </span>
    </div>
  )
}

export function reviewStateLabel(state: ReviewState): string {
  switch (state) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'requested changes'
    case 'DISMISSED':
      return 'dismissed'
    case 'PENDING':
      return 'pending review'
    case 'COMMENTED':
      return 'commented'
    default:
      return 'reviewed'
  }
}

function reviewStateClass(state: ReviewState): string {
  switch (state) {
    case 'APPROVED':
      return 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200'
    case 'CHANGES_REQUESTED':
      return 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200'
    case 'PENDING':
      return 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200'
    default:
      return 'border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
  }
}

function ConversationEntry({ item }: { item: ConversationItem }) {
  const when = item.kind === 'comment' ? item.createdAt : item.submittedAt
  return (
    <article className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <header className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Avatar actor={item.author} size={18} />
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.author.login}</span>
        {item.kind === 'review' ? (
          <span
            className={`rounded-full border px-1.5 py-px font-medium text-[11px] leading-4 ${reviewStateClass(item.state)}`}
          >
            {reviewStateLabel(item.state)}
          </span>
        ) : (
          <span>commented</span>
        )}
        {when && (
          <time dateTime={when} title={formatAbsolute(when)}>
            {formatRelative(when)}
          </time>
        )}
        {item.kind === 'review' && item.commentCount > 0 && (
          <span>
            · {item.commentCount} inline {item.commentCount === 1 ? 'comment' : 'comments'}
          </span>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="ml-auto hover:underline">
            GitHub ↗
          </a>
        )}
      </header>
      {item.bodyHTML.trim() ? (
        <div
          className="coja-markdown mt-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHTML is GitHub-sanitized markdown
          dangerouslySetInnerHTML={{ __html: item.bodyHTML }}
        />
      ) : null}
    </article>
  )
}

function itemTime(item: ConversationItem): number {
  const iso = item.kind === 'comment' ? item.createdAt : item.submittedAt
  if (!iso) return Number.POSITIVE_INFINITY // pending reviews (no submit time) sort last
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

function sortConversation(items: ConversationItem[]): ConversationItem[] {
  return [...items].sort((a, b) => itemTime(a) - itemTime(b))
}
