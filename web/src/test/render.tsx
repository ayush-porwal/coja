import { type DefaultOptions, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '../App'
import { createQueryClient } from '../api/queryClient'

type QueryDefaults = NonNullable<DefaultOptions['queries']>

/** Mounts the real route table at `path` with a fresh QueryClient (non-retrying unless overridden). */
export function renderAt(path: string, queryDefaults: QueryDefaults = { retry: false }) {
  const client = createQueryClient(queryDefaults)
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

/** The current pathname, for assertions on redirects and navigation. */
export function currentPath(): string {
  return screen.getByTestId('location').textContent ?? ''
}

function LocationProbe() {
  const location = useLocation()
  return (
    <span data-testid="location" hidden>
      {location.pathname}
    </span>
  )
}
