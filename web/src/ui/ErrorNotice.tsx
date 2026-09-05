import { Button } from './Button'
import { cn } from './cn'

export interface ErrorNoticeProps {
  title: string
  message?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

/** Inline failure state for a query: what failed, the server's message, and a retry. */
export function ErrorNotice({ title, message, onRetry, retrying, className }: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      className={cn('rounded-lg border border-danger bg-danger-soft p-4 text-sm', className)}
    >
      <p className="font-medium text-danger">{title}</p>
      {message && <p className="mt-1 break-words text-danger">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  )
}
