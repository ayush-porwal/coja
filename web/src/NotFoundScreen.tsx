import { Link } from 'react-router'
import { AppShell, linkClass } from './ui'

export function NotFoundScreen() {
  return (
    <AppShell>
      <div className="py-16 text-center">
        <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1 text-sm text-muted">Nothing lives at this address.</p>
        <Link to="/" className={`${linkClass} mt-4 inline-block text-sm`}>
          Back to projects
        </Link>
      </div>
    </AppShell>
  )
}
