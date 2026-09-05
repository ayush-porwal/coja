import type { ReviewEvent } from '@coja/shared/api'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from './errors'
import { useDiscardReview, useSubmitReview } from './hooks'
import { reviewStateLabel } from './Overview'

interface ReviewDialogProps {
  open: boolean
  projectId: string
  number: number
  pendingCount: number
  hasPendingReview: boolean
  onClose(): void
  /** Called with a toast message after a successful submit or discard. */
  onDone(message: string): void
}

const actionClass =
  'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

/** The Review ▾ submit dialog: summary + Approve / Request changes / Comment. */
export function ReviewDialog({
  open,
  projectId,
  number,
  pendingCount,
  hasPendingReview,
  onClose,
  onDone,
}: ReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = useSubmitReview(projectId, number)
  const discard = useDiscardReview(projectId, number)
  const busy = submit.isPending || discard.isPending

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
      setError(null)
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  const handleSubmit = async (event: ReviewEvent) => {
    setError(null)
    try {
      const result = await submit.mutateAsync({ event, body: body.trim() })
      setBody('')
      onDone(`Review submitted — ${reviewStateLabel(result.state)}`)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const handleDiscard = async () => {
    const noun = pendingCount === 1 ? 'comment' : 'comments'
    if (
      !window.confirm(
        `Discard your pending review and its ${pendingCount} ${noun}? This cannot be undone.`,
      )
    ) {
      return
    }
    setError(null)
    try {
      await discard.mutateAsync()
      onDone('Pending review discarded')
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={(e) => {
        // Escape closes via the native cancel event in most browsers; handle it explicitly too.
        if (e.key === 'Escape' && !busy) {
          e.preventDefault()
          onClose()
        }
      }}
      aria-labelledby="review-dialog-title"
      className="m-auto w-[540px] max-w-[92vw] rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} className="p-5">
        <h2 id="review-dialog-title" className="font-semibold text-base">
          Submit review
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {pendingCount === 0
            ? 'No pending comments. Your summary is published as the review body.'
            : `${pendingCount} pending ${pendingCount === 1 ? 'comment' : 'comments'} will become visible on GitHub with this review.`}
        </p>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">Summary</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            disabled={busy}
            placeholder="Leave a summary (optional for approvals)"
            className="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {error && (
          <p
            role="alert"
            className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700 text-xs dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSubmit('APPROVE')}
            disabled={busy}
            className={`${actionClass} bg-green-600 text-white hover:bg-green-700`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit('REQUEST_CHANGES')}
            disabled={busy}
            className={`${actionClass} bg-red-600 text-white hover:bg-red-700`}
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit('COMMENT')}
            disabled={busy}
            className={`${actionClass} border border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800`}
          >
            Comment
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`${actionClass} ml-auto text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}
          >
            Cancel
          </button>
        </div>
        {hasPendingReview && (
          <div className="mt-4 border-zinc-200 border-t pt-3 text-xs dark:border-zinc-700">
            <button
              type="button"
              onClick={() => void handleDiscard()}
              disabled={busy}
              className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              Discard pending review
            </button>
          </div>
        )}
      </form>
    </dialog>
  )
}
