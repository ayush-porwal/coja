import type { ReviewComment, ReviewThread } from '@coja/shared/api'
import { useState } from 'react'
import { ConfirmDialog } from '../ui'
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
  'rounded-full border px-1.5 py-px text-xs font-medium leading-4 border-edge-strong text-muted'

const textareaClass =
  'w-full resize-y rounded border border-edge-strong bg-canvas px-2 py-1.5 text-base text-ink outline-none focus:border-focus focus:ring-1 focus:ring-focus'

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
      className="my-1 min-w-0 rounded-md border border-edge bg-card font-sans text-sm shadow-sm"
    >
      {showHeader && (
        <header className="flex flex-wrap items-center gap-2 border-edge border-b px-3 py-1.5 text-xs text-muted">
          {thread.isResolved && (
            <span className={`${badgeClass} border-ok text-ok-text`}>Resolved</span>
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
      <ul className="divide-y divide-edge">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <CommentItem comment={comment} projectId={projectId} number={number} />
          </li>
        ))}
      </ul>
      <form
        className="border-edge border-t p-2"
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
          <p role="alert" className="mt-1 text-xs text-danger-text">
            {replyError}
          </p>
        )}
        <div className="mt-1.5 flex justify-end">
          <button
            type="submit"
            disabled={!replyBody.trim() || reply.isPending}
            className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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
    setError(null)
    try {
      await remove.mutateAsync(comment.id)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <article className="px-3 py-2">
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this comment?"
        description="It is deleted on GitHub. This cannot be undone."
        confirmLabel="Delete"
        icon="trash"
        busy={remove.isPending}
        onConfirm={() => {
          setConfirmingDelete(false)
          void del()
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
      <header className="flex items-center gap-2 text-xs text-muted">
        <Avatar actor={comment.author} size={18} />
        <span className="font-medium text-ink">{comment.author.login}</span>
        <time dateTime={comment.createdAt} title={formatAbsolute(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </time>
        {comment.isPending && (
          <span className={`${badgeClass} border-caution bg-caution-soft text-caution-text`}>
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
              onClick={() => setConfirmingDelete(true)}
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
              className="rounded px-2.5 py-1 text-xs text-muted hover:bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!draft.trim() || update.isPending}
              className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
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
        <p role="alert" className="mt-1 text-xs text-danger-text">
          {error}
        </p>
      )}
    </article>
  )
}
