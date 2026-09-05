import type { ReviewComment, ReviewThread } from '@coja/shared/api'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { errorMessage } from './errors'
import { formatAbsolute, formatRelative } from './format'
import { useDeleteComment, useReply, useUpdateComment } from './hooks'

interface CommentThreadProps {
  projectId: string
  number: number
  thread: ReviewThread
}

const badgeClass =
  'rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'

const textareaClass =
  'w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100'

/**
 * A GitHub review thread rendered inline under its diff line (light DOM, so
 * Tailwind applies). Replies follow GitHub's own rule: published immediately,
 * unless the viewer has a pending review open, in which case GitHub attaches
 * them to it (the refetched comment then carries `isPending`).
 */
export function CommentThread({ projectId, number, thread }: CommentThreadProps) {
  const reply = useReply(projectId, number)
  const [replyBody, setReplyBody] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)

  const submitReply = async () => {
    const body = replyBody.trim()
    if (!body || reply.isPending) return
    setReplyError(null)
    try {
      await reply.mutateAsync({ threadId: thread.id, body })
      setReplyBody('')
    } catch (error) {
      setReplyError(errorMessage(error))
    }
  }

  const fileLevel = thread.line === null
  const showHeader = thread.isResolved || thread.isOutdated || fileLevel

  return (
    <section
      aria-label={`Review thread on ${thread.path}`}
      className="my-1 rounded-md border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      {showHeader && (
        <header className="flex flex-wrap items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-700">
          {thread.isResolved && (
            <span
              className={`${badgeClass} border-green-300 text-green-700 dark:border-green-700 dark:text-green-300`}
            >
              Resolved
            </span>
          )}
          {thread.isOutdated && <span className={badgeClass}>Outdated</span>}
          {fileLevel && thread.originalLine !== null && (
            <span>
              originally on line {thread.originalLine}
              {thread.side === 'LEFT' ? ' (old file)' : ''}
            </span>
          )}
        </header>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <CommentItem comment={comment} projectId={projectId} number={number} />
          </li>
        ))}
      </ul>
      <form
        className="border-zinc-200 border-t p-2 dark:border-zinc-700"
        onSubmit={(e) => {
          e.preventDefault()
          void submitReply()
        }}
      >
        <textarea
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void submitReply()
            }
          }}
          rows={2}
          aria-label="Reply"
          placeholder="Reply… (published immediately — or added to your pending review if you have one open)"
          className={textareaClass}
        />
        {replyError && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {replyError}
          </p>
        )}
        <div className="mt-1.5 flex justify-end">
          <button
            type="submit"
            disabled={!replyBody.trim() || reply.isPending}
            className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            {reply.isPending ? 'Replying…' : 'Reply'}
          </button>
        </div>
      </form>
    </section>
  )
}

interface CommentItemProps {
  comment: ReviewComment
  projectId: string
  number: number
}

function CommentItem({ comment, projectId, number }: CommentItemProps) {
  const update = useUpdateComment(projectId, number)
  const remove = useDeleteComment(projectId, number)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const body = draft.trim()
    if (!body) return
    setError(null)
    try {
      await update.mutateAsync({ commentId: comment.id, body })
      setEditing(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const del = async () => {
    if (!window.confirm('Delete this comment on GitHub?')) return
    setError(null)
    try {
      await remove.mutateAsync(comment.id)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <article className="px-3 py-2">
      <header className="flex items-center gap-2 text-xs text-zinc-500">
        <Avatar actor={comment.author} size={18} />
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{comment.author.login}</span>
        <time dateTime={comment.createdAt} title={formatAbsolute(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </time>
        {comment.isPending && (
          <span
            className={`${badgeClass} border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200`}
          >
            Pending
          </span>
        )}
        {comment.isMine && !editing && (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(comment.body)
                setEditing(true)
              }}
              className="hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void del()}
              disabled={remove.isPending}
              className="hover:underline disabled:opacity-50"
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </span>
        )}
      </header>
      {editing ? (
        <div className="mt-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label="Edit comment"
            className={textareaClass}
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
              className="rounded px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!draft.trim() || update.isPending}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="coja-markdown mt-1"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHTML is GitHub-sanitized markdown
          dangerouslySetInnerHTML={{ __html: comment.bodyHTML }}
        />
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </article>
  )
}
