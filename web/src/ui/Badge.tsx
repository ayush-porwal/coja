import type { ComponentProps } from 'react'
import { cn } from './cn'

export type BadgeTone = 'neutral' | 'green' | 'red' | 'amber' | 'indigo'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-active text-muted ring-edge',
  green: 'bg-ok-soft text-ok ring-ok',
  red: 'bg-danger-soft text-danger ring-danger',
  amber: 'bg-caution-soft text-caution ring-caution',
  indigo: 'bg-accent-soft text-accent-text ring-accent',
}

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
