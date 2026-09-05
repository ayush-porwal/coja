/**
 * Data hooks for the AI panel (react-query, keys under `['ai', …]`). Chats
 * and models live on the local server; the live conversation itself is driven
 * by the Vercel AI SDK's `useChat` in `Conversation.tsx`, these hooks only
 * load and bookkeep.
 */
import {
  type AiContextResponse,
  API_ROUTES,
  type Chat,
  type ChatWithMessages,
  type ModelInfo,
  type NewChatRequest,
} from '@coja/shared/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, api } from '../../api/client'

export const aiKeys = {
  models: ['ai', 'models'] as const,
  chats: (projectId: string, number: number) => ['ai', 'chats', projectId, number] as const,
  chat: (projectId: string, number: number, chatId: string) =>
    ['ai', 'chat', projectId, number, chatId] as const,
  context: (projectId: string, number: number) => ['ai', 'context', projectId, number] as const,
}

/** True for a 404 from the API (e.g. a chat that was deleted since the id was persisted). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.code === 'not_found')
}

/** Models of every provider with a configured key; empty when none is set up. */
export function useAiModels() {
  return useQuery({
    queryKey: aiKeys.models,
    queryFn: () => api.get<ModelInfo[]>(API_ROUTES.aiModels),
    staleTime: 5 * 60_000,
  })
}

/** This PR's chats, newest first (the server orders by `updatedAt`). */
export function useChats(projectId: string, number: number) {
  return useQuery({
    queryKey: aiKeys.chats(projectId, number),
    queryFn: () => api.get<Chat[]>(API_ROUTES.prChats(projectId, number)),
  })
}

/**
 * One chat with its persisted messages. Named `useChatRecord` to keep clear of
 * the SDK's `useChat`. Not retried on 404 so a stale persisted id fails fast.
 */
export function useChatRecord(projectId: string, number: number, chatId: string | null) {
  return useQuery({
    queryKey: aiKeys.chat(projectId, number, chatId ?? ''),
    queryFn: () => api.get<ChatWithMessages>(API_ROUTES.prChat(projectId, number, chatId ?? '')),
    enabled: chatId !== null,
    // Always refetch on mount: switching to a history chat must show the
    // server's truth, never a possibly-stale cache entry.
    staleTime: 0,
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
  })
}

/** POST prChats. Seeds the new chat's record (empty) so switching to it needs no fetch. */
export function useCreateChat(projectId: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: NewChatRequest) =>
      api.post<Chat>(API_ROUTES.prChats(projectId, number), request),
    onSuccess: (chat) => {
      queryClient.setQueryData<ChatWithMessages>(aiKeys.chat(projectId, number, chat.id), {
        chat,
        messages: [],
      })
      queryClient.setQueryData<Chat[]>(aiKeys.chats(projectId, number), (prev) => [
        chat,
        ...(prev ?? []).filter((c) => c.id !== chat.id),
      ])
      void queryClient.invalidateQueries({ queryKey: aiKeys.chats(projectId, number) })
    },
  })
}

/** DELETE prChat. */
export function useDeleteChat(projectId: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (chatId: string) =>
      api.delete<{ ok: true }>(API_ROUTES.prChat(projectId, number, chatId)),
    onSuccess: (_result, chatId) => {
      queryClient.removeQueries({ queryKey: aiKeys.chat(projectId, number, chatId) })
      queryClient.setQueryData<Chat[]>(aiKeys.chats(projectId, number), (prev) =>
        prev?.filter((c) => c.id !== chatId),
      )
      void queryClient.invalidateQueries({ queryKey: aiKeys.chats(projectId, number) })
    },
  })
}

/** "What does the AI see?" — fetched on demand (`enabled` while the dialog is open). */
export function useAiContext(projectId: string, number: number, enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.context(projectId, number),
    queryFn: () => api.get<AiContextResponse>(API_ROUTES.prAiContext(projectId, number)),
    enabled,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// localStorage keys and validators (used with `usePersistedState`)
// ---------------------------------------------------------------------------

export const MODEL_STORAGE_KEY = 'coja.aiModel'
export const chatStorageKey = (projectId: string, number: number) =>
  `coja.aiChat:${projectId}:${number}`

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
