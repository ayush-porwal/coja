import {
  type AddProjectRequest,
  API_ROUTES,
  type Project,
  type ProviderId,
  type PullRequestSummary,
  type SaveKeyRequest,
  type SaveKeyResponse,
  type SetupStatus,
} from '@coja/shared/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/** Query keys, in one place so invalidation and reads can never drift apart. */
export const queryKeys = {
  setup: ['setup'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  prs: (projectId: string) => ['prs', projectId] as const,
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

export function useSaveKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveKeyRequest) => api.post<SaveKeyResponse>(API_ROUTES.setupKey, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.setup }),
  })
}

export function useDeleteKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: ProviderId) =>
      api.delete<{ ok: true }>(API_ROUTES.setupKeyDelete(provider)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.setup }),
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
      queryClient.removeQueries({ queryKey: queryKeys.prs(projectId) })
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export function usePullRequests(projectId: string) {
  return useQuery({
    queryKey: queryKeys.prs(projectId),
    queryFn: () => api.get<PullRequestSummary[]>(API_ROUTES.prs(projectId)),
  })
}
