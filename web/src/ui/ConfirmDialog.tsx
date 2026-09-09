import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { cn } from './cn'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger renders a red confirm action; primary the accent one. */
  tone?: 'danger' | 'primary'
  icon?: 'warning' | 'trash' | 'question'
  /** Disables both actions and shows the confirm spinner while the action runs. */
  busy?: boolean
  /**
   * Portal target; defaults to document.body. Nest inside a native modal
   * `<dialog>` by passing the dialog element — top-layer content always paints
   * above body-portaled overlays.
   */
  container?: HTMLElement | null
  onConfirm(): void
  onCancel(): void
}

/**
 * The app's confirmation modal — a small alert dialog with an icon, a title,
 * a description and Cancel/Confirm actions. Replaces the native
 * `window.confirm` prompts. Focus starts on Cancel (the safe action), Escape
 * and clicks outside cancel, and focus returns to the opener on close.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  icon = 'warning',
  busy = false,
  container,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    cancelRef.current?.focus()
    return () => {
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (open && busy) cardRef.current?.focus()
  }, [open, busy])

  // Click outside the card cancels (the safe action); a document listener keeps
  // the overlay itself free of handlers.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node) && !busy) onCancel()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, busy, onCancel])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Consume here so an opened dialog does not also receive it and close itself.
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (e.key === 'Tab') {
      // Include any links in the description, and keep focus inside while busy.
      const actions = Array.from(
        cardRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      )
      e.preventDefault()
      e.stopPropagation()
      const index =
        document.activeElement instanceof HTMLElement ? actions.indexOf(document.activeElement) : -1
      const next =
        index < 0
          ? e.shiftKey
            ? actions.length - 1
            : 0
          : (index + (e.shiftKey ? -1 : 1) + actions.length) % actions.length
      ;(actions[next] ?? cardRef.current)?.focus()
    }
  }

  return createPortal(
    <div className="coja-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={onKeyDown}
        className="coja-modal-card max-h-[calc(100dvh-2rem)] w-[380px] max-w-full overflow-y-auto overscroll-contain rounded-xl border border-edge bg-card p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full',
              tone === 'danger' ? 'bg-danger-soft text-danger-text' : 'bg-active text-accent-text',
            )}
          >
            {icon === 'trash' ? <TrashIcon /> : <WarningIcon />}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 break-words text-sm text-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            data-confirm
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    container ?? document.body,
  )
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-5">
      <path
        d="M10 3.5 18 16.5H2L10 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-5">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2.5 0-.6 9a2 2 0 0 1-2 1.9H8.1a2 2 0 0 1-2-1.9L5.5 6M8.3 9v4.5M11.7 9v4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
