import type { ReviewEvent } from '@coja/shared/api'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui'
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
  'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus'

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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
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
    setConfirmingDiscard(false)
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
      className="m-auto w-[540px] max-w-[92vw] rounded-lg border border-edge bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} className="p-5">
        <h2 id="review-dialog-title" className="font-semibold text-base">
          Submit review
        </h2>
        <p className="mt-1 text-sm text-muted">
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
            className="w-full resize-y rounded border border-edge-strong bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
        </label>
        {error && (
          <p
            role="alert"
            className="mt-2 rounded border border-danger bg-danger-soft px-2 py-1 text-xs text-danger"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSubmit('APPROVE')}
            disabled={busy}
            className={`${actionClass} bg-ok-button text-status-button-ink hover:opacity-90`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit('REQUEST_CHANGES')}
            disabled={busy}
            className={`${actionClass} bg-danger-button text-status-button-ink hover:opacity-90`}
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit('COMMENT')}
            disabled={busy}
            className={`${actionClass} border border-edge-strong text-ink hover:bg-hover`}
          >
            Comment
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`${actionClass} ml-auto text-muted hover:bg-hover`}
          >
            Cancel
          </button>
        </div>
        {hasPendingReview && (
          <div className="mt-4 border-edge border-t pt-3 text-xs">
            <button
              type="button"
              onClick={() => setConfirmingDiscard(true)}
              disabled={busy}
              className="text-danger hover:underline disabled:opacity-50"
            >
              Discard pending review
            </button>
          </div>
        )}
        <ConfirmDialog
          open={confirmingDiscard}
          container={dialogRef.current}
          title="Discard pending review?"
          description={`Its ${pendingCount} pending ${
            pendingCount === 1 ? 'comment' : 'comments'
          } and the summary are removed. This cannot be undone.`}
          confirmLabel="Discard"
          busy={discard.isPending}
          onConfirm={() => void handleDiscard()}
          onCancel={() => setConfirmingDiscard(false)}
        />
      </form>
    </dialog>
  )
}
