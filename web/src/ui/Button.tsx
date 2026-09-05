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
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
)

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-edge-strong bg-canvas text-ink hover:bg-hover',
  danger: 'bg-danger text-white hover:opacity-90',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
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
