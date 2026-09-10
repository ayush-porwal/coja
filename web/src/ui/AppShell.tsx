import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { BrandMark } from '../brand/BrandMark'
import { useTheme } from '../themes/ThemeContext'
import { cn, focusRing } from './cn'

export interface AppShellProps {
  /** Rendered after the wordmark as `coja / <breadcrumb>`. */
  breadcrumb?: ReactNode
  /** Right-aligned header actions, after the settings gear. */
  actions?: ReactNode
  children: ReactNode
}

/** The header's settings entry: a gear that leads to /setup. */
function SettingsLink({ active }: { active: boolean }) {
  return (
    <Link
      to="/setup"
      aria-label="Settings"
      title="Settings"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center rounded p-1.5',
        focusRing,
        active ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </Link>
  )
}

/**
 * Header + centred content column shared by Setup, Projects and the PR list.
 * The wordmark is the way home — the CJ mark in the active theme beside the
 * name — and the breadcrumb names where you are (Setup
 * renders a "Settings" crumb automatically), evenly spaced as one run of
 * `coja / crumb`. The PR review screen uses its own full-bleed layout and
 * does not go through here.
 */
export function AppShell({ breadcrumb, actions, children }: AppShellProps) {
  const { pathname } = useLocation()
  const { palette, appearance } = useTheme()
  const setupActive = pathname.startsWith('/setup')
  const crumb = breadcrumb ?? (setupActive ? 'Settings' : null)
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-edge bg-chrome">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-4">
          <Link
            to="/"
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-sm text-base font-semibold tracking-tight',
              focusRing,
            )}
          >
            <BrandMark paletteId={palette.id} appearance={appearance} size={20} />
            coja
          </Link>
          {crumb && (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2.5 text-sm">
              <span aria-hidden="true" className="select-none text-faint">
                /
              </span>
              <span className="truncate font-medium">{crumb}</span>
            </nav>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <SettingsLink active={setupActive} />
            {actions && <div className="ml-1.5 flex items-center gap-2">{actions}</div>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
