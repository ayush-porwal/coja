import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSetupStatus } from '../api/hooks'
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
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <span className="text-2xl font-semibold tracking-tight text-zinc-400 dark:text-zinc-600">
        coja
      </span>
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div
        role="alert"
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <p className="text-base font-semibold tracking-tight">coja can't reach its server</p>
        <p className="mt-2 break-words font-mono text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
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
