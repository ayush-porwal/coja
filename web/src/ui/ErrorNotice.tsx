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
      className={cn(
        'rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40',
        className,
      )}
    >
      <p className="font-medium text-red-800 dark:text-red-300">{title}</p>
      {message && <p className="mt-1 break-words text-red-700 dark:text-red-300/90">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  )
}
