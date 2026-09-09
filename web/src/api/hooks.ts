import {
  type AddCustomProviderRequest,
  type AddProjectRequest,
  API_ROUTES,
  type ChatGptConnectStatus,
  type CustomProvidersResponse,
  type DirListing,
  type FetchCustomModelsRequest,
  type FetchCustomModelsResponse,
  isEmptyFilter,
  type PrListFilter,
  type Project,
  type PullRequestPage,
  type RepositoryContributor,
  type SetupStatus,
} from '@coja/shared/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiKeys } from '../pr/ai/hooks'
import { api } from './client'

/** Query keys, in one place so invalidation and reads can never drift apart. */
export const queryKeys = {
  setup: ['setup'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  prs: (projectId: string, page: number, filterKey: string) =>
    ['prs', projectId, page, filterKey] as const,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function useSetupStatus() {
  return useQuery({
    queryKey: queryKeys.setup,
    queryFn: () => api.get<SetupStatus>(API_ROUTES.setupStatus),
  })
}

export function useAddCustomProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AddCustomProviderRequest) =>
      api.post<CustomProvidersResponse>(API_ROUTES.setupCustomProviders, body),
    onSuccess: (data) => {
      // Seed the fresh list; the status refetch picks it up too.
      queryClient.setQueryData<SetupStatus>(queryKeys.setup, (prev) =>
        prev ? { ...prev, customProviders: data.customProviders } : prev,
      )
      // The chat panel caches /api/ai/models — drop it so the new provider is
      // there on the next visit without a reload.
      queryClient.invalidateQueries({ queryKey: aiKeys.models })
    },
  })
}

export function useFetchCustomModels() {
  return useMutation({
    mutationFn: (body: FetchCustomModelsRequest) =>
      api.post<FetchCustomModelsResponse>(API_ROUTES.setupCustomModels, body),
  })
}

export function useDeleteCustomProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(API_ROUTES.setupCustomProviderDelete(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.setup })
      queryClient.invalidateQueries({ queryKey: aiKeys.models })
    },
  })
}

export function useCompleteSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<SetupStatus>(API_ROUTES.setupComplete),
    // The response *is* the fresh status: seed the cache so the boot guard lets
    // `/` through on the very next render instead of waiting for a refetch.
    onSuccess: (status) => queryClient.setQueryData(queryKeys.setup, status),
  })
}

// ---------------------------------------------------------------------------
// ChatGPT subscription
// ---------------------------------------------------------------------------

export interface ConnectChatGptResponse {
  ok: true
  /** The authorization page — the server also opens it in the browser. */
  authUrl: string
}

/** Start the browser sign-in; completion arrives via `useChatGptConnectStatus`. */
export function useConnectChatGpt() {
  return useMutation({
    mutationFn: () => api.post<ConnectChatGptResponse>(API_ROUTES.setupChatgptConnect),
  })
}

/**
 * Poll while a sign-in is open (`enabled`); the server opens the browser and
 * completes the flow in the background.
 */
export function useChatGptConnectStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['setup', 'chatgpt-status'],
    queryFn: () => api.get<ChatGptConnectStatus>(API_ROUTES.setupChatgptStatus),
    enabled,
    refetchInterval: 1500,
  })
}

/** Forget the stored tokens. There is no upstream revoke on this client. */
export function useDisconnectChatGpt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<{ ok: true }>(API_ROUTES.setupChatgptDisconnect),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.setup })
      queryClient.invalidateQueries({ queryKey: aiKeys.models })
    },
  })
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => api.get<Project[]>(API_ROUTES.projects),
  })
}

export function useProject(projectId: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<Project>(API_ROUTES.project(projectId)),
    // Arriving from the list, paint the breadcrumb from the cached row right away.
    placeholderData: () =>
      queryClient
        .getQueryData<Project[]>(queryKeys.projects)
        ?.find((project) => project.id === projectId),
  })
}

/** The server user's home directory — the path picker's start point. */
export function useFsHome(enabled: boolean) {
  return useQuery({
    queryKey: ['fs-home'],
    queryFn: () => api.get<{ home: string }>(API_ROUTES.fsHome),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Subdirectories of `path` filtered by `prefix` (server-side, capped). Disabled
 * unless both the picker is open and `path` looks absolute — the server would
 * otherwise answer 400 for every keystroke of a relative path.
 */
export function useFsDirs(path: string, prefix: string, enabled: boolean) {
  return useQuery({
    queryKey: ['fs-dirs', path, prefix],
    queryFn: () => {
      const params = new URLSearchParams({ path })
      if (prefix) params.set('prefix', prefix)
      return api.get<DirListing>(`${API_ROUTES.fsDirs}?${params.toString()}`)
    },
    enabled: enabled && path.startsWith('/'),
    // Each (path, prefix) pair is its own cache entry; listings stay fresh.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}

export function useAddProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AddProjectRequest) => api.post<Project>(API_ROUTES.projects, body),
    onSuccess: (project) => {
      queryClient.setQueryData(queryKeys.project(project.id), project)
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => api.delete<{ ok: true }>(API_ROUTES.project(projectId)),
    onSuccess: (_result, projectId) => {
      queryClient.removeQueries({ queryKey: queryKeys.project(projectId) })
      // Prefix match: drop every cached page of this project.
      queryClient.removeQueries({ queryKey: ['prs', projectId] })
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/**
 * One page of open PRs (100 per page). Each page is its own cache entry: a
 * revisited page renders instantly with no network call, while a page that
 * must be fetched shows the skeletons again (`isPending` until it arrives).
 * Filters are part of the key, so each filter combination pages independently.
 */
export function usePullRequests(projectId: string, page: number, filter: PrListFilter) {
  return useQuery({
    queryKey: queryKeys.prs(projectId, page, prFilterKey(filter)),
    queryFn: () => {
      const params = new URLSearchParams()
      if (page > 1) params.set('page', String(page))
      if (filter.state && filter.state !== 'open') params.set('state', filter.state)
      if (filter.text) params.set('text', filter.text)
      if (filter.author) params.set('author', filter.author)
      if (filter.head) params.set('head', filter.head)
      if (filter.base) params.set('base', filter.base)
      if (filter.draft !== undefined) params.set('draft', String(filter.draft))
      const query = params.toString()
      return api.get<PullRequestPage>(`${API_ROUTES.prs(projectId)}${query ? `?${query}` : ''}`)
    },
  })
}

/** Stable identity for a filter (cache keys and effect deps). */
export function prFilterKey(filter: PrListFilter): string {
  return [
    filter.text ?? '',
    filter.author ?? '',
    filter.head ?? '',
    filter.base ?? '',
    filter.draft === undefined ? '' : String(filter.draft),
    filter.state === 'open' ? '' : (filter.state ?? ''),
  ].join('|')
}

/** True when no filter field is set. */
export function isPrFilterEmpty(filter: PrListFilter): boolean {
  return isEmptyFilter(filter)
}

export function useContributors(projectId: string) {
  return useQuery({
    queryKey: ['contributors', projectId],
    queryFn: () => api.get<RepositoryContributor[]>(API_ROUTES.contributors(projectId)),
    staleTime: 30 * 60_000,
    retry: false,
  })
}
