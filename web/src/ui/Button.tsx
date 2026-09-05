import type { ComponentProps } from 'react'
import { cn, focusRing } from './cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and disables the button while an action is in flight. */
  loading?: boolean
  /** Square button for a lone icon; pass `aria-label`. */
  iconOnly?: boolean
}

const base = cn(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
)

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost:
    'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
}

const sizes: Record<ButtonSize, { text: string; wide: string; square: string }> = {
  sm: { text: 'h-7 text-xs', wide: 'px-2.5', square: 'w-7' },
  md: { text: 'h-8 text-sm', wide: 'px-3', square: 'w-8' },
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconOnly = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const dims = sizes[size]
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        base,
        variants[variant],
        dims.text,
        iconOnly ? dims.square : dims.wide,
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}
