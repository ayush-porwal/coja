import { type DefaultOptions, QueryClient } from '@tanstack/react-query'

type QueryDefaults = NonNullable<DefaultOptions['queries']>

/**
 * One place for the app-wide query defaults. Tests pass `{ retry: false }` so
 * error paths settle immediately.
 */
export function createQueryClient(overrides: QueryDefaults = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 10_000,
        ...overrides,
      },
    },
  })
}
