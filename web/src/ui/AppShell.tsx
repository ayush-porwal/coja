import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn, focusRing } from './cn'

export interface AppShellProps {
  /** Rendered after the wordmark as `coja / <breadcrumb>`. */
  breadcrumb?: ReactNode
  /** Right-aligned header actions. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * Header + centred content column shared by Setup, Projects and the PR list.
 * The PR review screen uses its own full-bleed layout and does not go through here.
 */
export function AppShell({ breadcrumb, actions, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
          <Link
            to="/"
            className={cn('rounded-sm text-base font-semibold tracking-tight', focusRing)}
          >
            coja
          </Link>
          {breadcrumb && (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                /
              </span>
              {breadcrumb}
            </nav>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
