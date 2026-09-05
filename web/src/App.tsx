import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { BootGuard } from './boot/BootGuard'
import { NotFoundScreen } from './NotFoundScreen'
import { PullRequestScreen } from './pr/PullRequestScreen'
import { ProjectsScreen } from './projects/ProjectsScreen'
import { PullRequestListScreen } from './prs/PullRequestListScreen'
import { SetupScreen } from './setup/SetupScreen'

const queryClient = createQueryClient()

/**
 * The route table, wrapped in the boot guard so an unfinished setup always
 * lands on `/setup`. Exported on its own so tests can mount it in a
 * MemoryRouter with a fresh QueryClient.
 */
export function AppRoutes() {
  return (
    <BootGuard>
      <Routes>
        <Route path="/setup" element={<SetupScreen />} />
        <Route path="/" element={<ProjectsScreen />} />
        <Route path="/p/:projectId" element={<PullRequestListScreen />} />
        <Route path="/p/:projectId/pr/:number" element={<PullRequestScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </BootGuard>
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
