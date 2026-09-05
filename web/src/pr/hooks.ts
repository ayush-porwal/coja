/**
 * Data hooks for the PR review screen. Everything goes through the typed
 * `api` client; GitHub remains the source of truth, so every mutation
 * invalidates the PR detail query when it settles.
 */
import {
  type AddCommentRequest,
  type AddCommentResponse,
  API_ROUTES,
  type FetchStatus,
  type FileDiffResponse,
  type GitChangedFile,
  type PrRef,
  type PullRequestDetail,
  type ReplyRequest,
  type ReplyResponse,
  type ReviewComment,
  type SetViewedRequest,
  type SetViewedResponse,
  type SubmitReviewRequest,
  type SubmitReviewResponse,
  type UpdateCommentRequest,
} from '@coja/shared/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'

// ---------------------------------------------------------------------------
// Keys and URLs
// ---------------------------------------------------------------------------

export const prKeys = {
  detail: (projectId: string, number: number) => ['pr', projectId, number] as const,
  fetch: (projectId: string, number: number) => ['pr-fetch', projectId, number] as const,
  gitFiles: (projectId: string, number: number) => ['pr-git-files', projectId, number] as const,
  diff: (
    projectId: string,
    number: number,
    path: string,
    previousPath?: string,
    revision?: string,
  ) => ['pr-diff', projectId, number, revision ?? '', path, previousPath ?? ''] as const,
}

export function diffUrl(projectId: string, number: number, path: string, previousPath?: string) {
  const params = new URLSearchParams({ path })
  if (previousPath) params.set('previousPath', previousPath)
  return `${API_ROUTES.prDiff(projectId, number)}?${params.toString()}`
}

export function blobUrl(
  projectId: string,
  number: number,
  ref: PrRef,
  path: string,
  start?: number,
  end?: number,
) {
  const params = new URLSearchParams({ ref, path })
  if (start !== undefined) params.set('start', String(start))
  if (end !== undefined) params.set('end', String(end))
  return `${API_ROUTES.prBlob(projectId, number)}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function usePullRequest(projectId: string, number: number) {
  return useQuery({
    queryKey: prKeys.detail(projectId, number),
    queryFn: () => api.get<PullRequestDetail>(API_ROUTES.pr(projectId, number)),
  })
}

const ACTIVE_FETCH_STATES: ReadonlySet<FetchStatus['state']> = new Set(['idle', 'fetching'])
export const FETCH_POLL_MS = 1000

/**
 * Starts the background `git fetch` for the PR (POST, idempotent) on mount and
 * polls its status every second until it is `ready` or `error`. `retry()`
 * re-POSTs, which is how the user recovers from a failed fetch.
 */
export function useFetchStatus(projectId: string, number: number, pollMs = FETCH_POLL_MS) {
  // Which PR we have already POSTed for; the first queryFn run per PR starts the fetch.
  const startedFor = useRef('')
  const prKey = `${projectId}#${number}`
  const query = useQuery({
    queryKey: prKeys.fetch(projectId, number),
    queryFn: async () => {
      const route = API_ROUTES.prFetch(projectId, number)
      if (startedFor.current !== prKey) {
        startedFor.current = prKey
        return api.post<FetchStatus>(route)
      }
      return api.get<FetchStatus>(route)
    },
    refetchInterval: (q) => {
      const state = q.state.data?.state
      return state !== undefined && ACTIVE_FETCH_STATES.has(state) ? pollMs : false
    },
    // Keep polling while the tab is in the background: the fetch finishes without the user watching.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const { refetch } = query
  const retry = useCallback(() => {
    startedFor.current = ''
    void refetch()
  }, [refetch])
  return { status: query.data, error: query.error, isPending: query.isPending, retry }
}

export function useGitFiles(projectId: string, number: number, enabled: boolean) {
  return useQuery({
    queryKey: prKeys.gitFiles(projectId, number),
    queryFn: () => api.get<GitChangedFile[]>(API_ROUTES.prGitFiles(projectId, number)),
    enabled,
    staleTime: 60_000,
  })
}

export function fetchFileDiff(
  projectId: string,
  number: number,
  path: string,
  previousPath?: string,
) {
  return api.get<FileDiffResponse>(diffUrl(projectId, number, path, previousPath))
}

export function useFileDiff(
  projectId: string,
  number: number,
  path: string,
  previousPath?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: prKeys.diff(projectId, number, path, previousPath),
    queryFn: () => fetchFileDiff(projectId, number, path, previousPath),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export interface DiffTarget {
  path: string
  previousPath?: string
}

export type DiffEntry = FileDiffResponse | 'loading' | Error

export interface FileDiffsResult {
  /** One entry per requested file, keyed by path. */
  diffs: ReadonlyMap<string, DiffEntry>
  /** Files whose request has settled (success or error). */
  loaded: number
  failed: number
  total: number
}

export const DIFF_CONCURRENCY = 4
const DIFF_RETRY_DELAY_MS = 500

/**
 * Loads every file's patch with bounded concurrency, in file order, so the diff
 * renders progressively as objects arrive. Results are stored in the query
 * cache (shared with `useFileDiff`); `revision` (the fetched head OID) scopes
 * the cache so a moved head reloads the patches.
 */
export function useFileDiffs(
  projectId: string,
  number: number,
  files: readonly DiffTarget[] | undefined,
  enabled: boolean,
  revision?: string,
): FileDiffsResult {
  const queryClient = useQueryClient()
  const signature = (files ?? []).map((f) => `${f.path}\t${f.previousPath ?? ''}`).join('\n')
  // A target list whose identity only changes when the file list really changes,
  // so the loader effect below does not restart on every PR refetch.
  const targetsRef = useRef<{ signature: string; targets: DiffTarget[] }>({
    signature: '',
    targets: [],
  })
  if (targetsRef.current.signature !== signature) {
    targetsRef.current = {
      signature,
      targets: (files ?? []).map((f) => ({ path: f.path, previousPath: f.previousPath })),
    }
  }
  const targets = targetsRef.current.targets
  const [diffs, setDiffs] = useState<Map<string, DiffEntry>>(() => new Map())

  useEffect(() => {
    const keyFor = (t: DiffTarget) =>
      prKeys.diff(projectId, number, t.path, t.previousPath, revision)
    const initial = new Map<string, DiffEntry>()
    for (const t of targets) {
      initial.set(t.path, queryClient.getQueryData<FileDiffResponse>(keyFor(t)) ?? 'loading')
    }
    setDiffs(initial)
    if (!enabled) return
    const queue = targets.filter((t) => initial.get(t.path) === 'loading')
    if (queue.length === 0) return

    let cancelled = false
    const worker = async () => {
      while (!cancelled) {
        const next = queue.shift()
        if (!next) return
        let entry: DiffEntry
        try {
          entry = await queryClient.fetchQuery({
            queryKey: keyFor(next),
            queryFn: () => fetchFileDiff(projectId, number, next.path, next.previousPath),
            staleTime: Number.POSITIVE_INFINITY,
            retry: 1,
            retryDelay: DIFF_RETRY_DELAY_MS,
          })
        } catch (error) {
          entry = error instanceof Error ? error : new Error(String(error))
        }
        if (cancelled) return
        setDiffs((prev) => {
          const nextMap = new Map(prev)
          nextMap.set(next.path, entry)
          return nextMap
        })
      }
    }
    // Workers shift the queue synchronously, so fix the count before starting them.
    const workerCount = Math.min(DIFF_CONCURRENCY, queue.length)
    for (let i = 0; i < workerCount; i++) void worker()
    return () => {
      cancelled = true
    }
  }, [queryClient, projectId, number, targets, enabled, revision])

  return useMemo(() => {
    let loaded = 0
    let failed = 0
    for (const entry of diffs.values()) {
      if (entry !== 'loading') loaded++
      if (entry instanceof Error) failed++
    }
    return { diffs, loaded, failed, total: targets.length }
  }, [diffs, targets])
}

// ---------------------------------------------------------------------------
// Mutations — each one talks to GitHub immediately and refreshes the PR detail.
// ---------------------------------------------------------------------------

function useInvalidatePr(projectId: string, number: number) {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: prKeys.detail(projectId, number) }),
    [queryClient, projectId, number],
  )
}

export function useAddComment(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: (request: AddCommentRequest) =>
      api.post<AddCommentResponse>(API_ROUTES.prComments(projectId, number), request),
    onSettled: () => invalidate(),
  })
}

export function useReply(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      api.post<ReplyResponse>(API_ROUTES.prThreadReplies(projectId, number, threadId), {
        body,
      } satisfies ReplyRequest),
    onSettled: () => invalidate(),
  })
}

export function useUpdateComment(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.patch<ReviewComment>(API_ROUTES.prComment(projectId, number, commentId), {
        body,
      } satisfies UpdateCommentRequest),
    onSettled: () => invalidate(),
  })
}

export function useDeleteComment(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: (commentId: string) =>
      api.delete<{ ok: true }>(API_ROUTES.prComment(projectId, number, commentId)),
    onSettled: () => invalidate(),
  })
}

/** Toggles GitHub's viewed checkmark; the file's `viewedState` is updated optimistically. */
export function useSetViewed(projectId: string, number: number) {
  const queryClient = useQueryClient()
  const key = prKeys.detail(projectId, number)
  return useMutation({
    mutationFn: (request: SetViewedRequest) =>
      api.post<SetViewedResponse>(API_ROUTES.prViewed(projectId, number), request),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<PullRequestDetail>(key)
      if (previous) {
        queryClient.setQueryData<PullRequestDetail>(key, {
          ...previous,
          files: previous.files.map((f) =>
            f.path === request.path
              ? { ...f, viewedState: request.viewed ? 'VIEWED' : 'UNVIEWED' }
              : f,
          ),
        })
      }
      return { previous }
    },
    onError: (_error, _request, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useSubmitReview(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: (request: SubmitReviewRequest) =>
      api.post<SubmitReviewResponse>(API_ROUTES.prReview(projectId, number), request),
    onSettled: () => invalidate(),
  })
}

export function useDiscardReview(projectId: string, number: number) {
  const invalidate = useInvalidatePr(projectId, number)
  return useMutation({
    mutationFn: () => api.delete<{ ok: true }>(API_ROUTES.prReview(projectId, number)),
    onSettled: () => invalidate(),
  })
}
