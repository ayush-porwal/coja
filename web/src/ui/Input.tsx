import type { ComponentProps } from 'react'
import { cn } from './cn'

export const controlClass = cn(
  'h-8 w-full rounded-md border bg-canvas px-2.5 text-sm text-ink shadow-xs',
  'placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus',
)

export const controlBorder = (invalid: boolean | undefined) =>
  invalid ? 'border-danger' : 'border-edge-strong'

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(controlClass, controlBorder(invalid), className)}
      {...rest}
    />
  )
}
