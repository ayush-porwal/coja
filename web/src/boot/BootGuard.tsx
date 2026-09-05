import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSetupStatus } from '../api/hooks'
import { BrandLoader } from '../brand/BrandLoader'
import { Button } from '../ui/Button'

/**
 * Loads the setup status once at boot and keeps unfinished setups on `/setup`.
 *
 * - No data yet → centred splash.
 * - The request itself failed (server down) → inline error with a retry.
 * - `gh` broken or setup not complete → redirect to `/setup` (never *from* it).
 *
 * Once we have data we keep rendering the app even if a later background refetch
 * fails, so a server hiccup mid-session never bounces the user around.
 */
export function BootGuard({ children }: { children: ReactNode }) {
  const status = useSetupStatus()
  const location = useLocation()

  if (status.data === undefined) {
    if (status.isError) {
      return (
        <BootError
          message={status.error.message}
          retrying={status.isFetching}
          onRetry={() => void status.refetch()}
        />
      )
    }
    return <Splash />
  }

  const { gh, setupComplete } = status.data
  if ((!gh.ok || !setupComplete) && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}

function Splash() {
  // Reads the persisted palette + OS appearance directly: the theme provider
  // mounts later and the splash must be on-theme from the first frame.
  let paletteId = 'mulberry'
  let appearance: 'light' | 'dark' = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
  try {
    const raw = localStorage.getItem('coja.theme')
    if (raw) {
      const parsed = JSON.parse(raw) as {
        palette?: string
        appearance?: string
      }
      if (typeof parsed.palette === 'string' && parsed.palette) paletteId = parsed.palette
      if (parsed.appearance === 'light' || parsed.appearance === 'dark') {
        appearance = parsed.appearance
      }
    }
  } catch {
    // unreadable storage: default palette + OS appearance
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <BrandLoader
        paletteId={paletteId}
        appearance={appearance}
        size="huge"
        label="Loading coja"
        /* 2.5x: the full write finishes in ~1.8s, before the status check
           resolves and the real screen replaces the splash. */
        speed={2.5}
      />
    </div>
  )
}

function BootError({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div
        role="alert"
        className="w-full max-w-md rounded-lg border border-edge bg-card p-6 text-ink shadow-xs"
      >
        <p className="text-base font-semibold tracking-tight">coja can't reach its server</p>
        <p className="mt-2 break-words font-mono text-xs text-danger">{message}</p>
        <p className="mt-2 text-sm text-muted">
          Is <code className="font-mono">coja</code> still running in your terminal? Start it again,
          then retry.
        </p>
        <Button variant="primary" className="mt-4" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      </div>
    </div>
  )
}
