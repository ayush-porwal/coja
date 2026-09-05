import type { ReactNode } from 'react'
import { cn } from './cn'

export interface FieldProps {
  label: ReactNode
  /** id of the control rendered as `children`; used for the label and the hint/error ids. */
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}

/** Label + control + hint + error. The error is a live region so it is announced when it appears. */
export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
