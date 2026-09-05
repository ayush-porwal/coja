import type { ComponentProps } from 'react'
import { cn } from './cn'
import { controlBorder, controlClass } from './Input'

export interface SelectProps extends ComponentProps<'select'> {
  invalid?: boolean
}

/** Native select styled like `Input`; keeps keyboard and screen-reader behaviour for free. */
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(controlClass, controlBorder(invalid), 'pr-8', className)}
      {...rest}
    >
      {children}
    </select>
  )
}
