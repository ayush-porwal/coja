import type { ComponentProps } from 'react'
import { cn } from './cn'

export const controlClass = cn(
  'h-8 w-full rounded-md border bg-white px-2.5 text-sm text-zinc-900 shadow-xs',
  'placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-indigo-500',
  'dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500',
)

export const controlBorder = (invalid: boolean | undefined) =>
  invalid ? 'border-red-500 dark:border-red-500' : 'border-zinc-300 dark:border-zinc-700'

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
