import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useMatch } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { BootGuard, Splash } from './boot/BootGuard'
import { NotFoundScreen } from './NotFoundScreen'
import { loadPullRequestScreen, preloadPullRequestScreen } from './pr/loadScreen'
import { ProjectsScreen } from './projects/ProjectsScreen'
import { PullRequestListScreen } from './prs/PullRequestListScreen'
import { SetupScreen } from './setup/SetupScreen'
import { ThemeProvider } from './themes/ThemeContext'

const queryClient = createQueryClient()
const PullRequestScreen = lazy(loadPullRequestScreen)

/**
 * The route table, wrapped in the boot guard so an unfinished setup always
 * lands on `/setup`. Exported on its own so tests can mount it in a
 * MemoryRouter with a fresh QueryClient.
 */
export function AppRoutes() {
  const isReview = useMatch('/p/:projectId/pr/:number') !== null
  useEffect(() => {
    // On direct links, load the editor alongside the boot status request.
    if (isReview) preloadPullRequestScreen()
  }, [isReview])
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
