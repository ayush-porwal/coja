import { API_ROUTES, type HealthResponse } from '@coja/shared/api'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'

const queryClient = new QueryClient()

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(API_ROUTES.health)
  if (!res.ok) throw new Error(`GET ${API_ROUTES.health} failed with ${res.status}`)
  return (await res.json()) as HealthResponse
}

function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth })
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">coja</h1>
        <p className="mt-3 font-mono text-sm text-zinc-400">
          {statusLine(health.data, health.isError)}
        </p>
      </div>
    </main>
  )
}

function statusLine(health: HealthResponse | undefined, isError: boolean): string {
  if (health) return `v${health.version} · server: ok`
  if (isError) return 'server: unreachable'
  return 'connecting…'
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
