import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { BootGuard, Splash } from './boot/BootGuard'
import { NotFoundScreen } from './NotFoundScreen'
import { ProjectsScreen } from './projects/ProjectsScreen'
import { PullRequestListScreen } from './prs/PullRequestListScreen'
import { SetupScreen } from './setup/SetupScreen'
import { ThemeProvider } from './themes/ThemeContext'

const queryClient = createQueryClient()
const PullRequestScreen = lazy(() =>
  import('./pr/PullRequestScreen').then((module) => ({ default: module.PullRequestScreen })),
)

/**
 * The route table, wrapped in the boot guard so an unfinished setup always
 * lands on `/setup`. Exported on its own so tests can mount it in a
 * MemoryRouter with a fresh QueryClient.
 */
export function AppRoutes() {
  return (
    <ThemeProvider>
      <BootGuard>
        <Routes>
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/" element={<ProjectsScreen />} />
          <Route path="/p/:projectId" element={<PullRequestListScreen />} />
          <Route
            path="/p/:projectId/pr/:number"
            element={
              <Suspense fallback={<Splash />}>
                <PullRequestScreen />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </BootGuard>
    </ThemeProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
