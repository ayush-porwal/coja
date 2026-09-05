import { cn } from './cn'

export interface SpinnerProps {
  size?: 'sm' | 'md'
  /** Announced to assistive tech. Omit for a purely decorative spinner (e.g. inside a busy button). */
  label?: string
  className?: string
}

export function Spinner({ size = 'sm', label, className }: SpinnerProps) {
  const a11y = label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <span {...a11y} className={cn('inline-flex shrink-0', className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={cn('animate-spin', size === 'sm' ? 'size-4' : 'size-6')}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
