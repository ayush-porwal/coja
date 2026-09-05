import type { ChatWithMessages, PullRequestDetail } from '@coja/shared/api'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, ErrorNotice, Spinner } from '../../ui'
import { errorMessage } from '../errors'
import { usePersistedState } from '../usePersistedState'
import { Composer, type ComposerHandle } from './Composer'
import { ContextDialog } from './ContextDialog'
import { type ChatControls, Conversation } from './Conversation'
import { HistoryMenu } from './HistoryMenu'
import {
  aiKeys,
  chatStorageKey,
  isNotFound,
  isNullableString,
  isString,
  MODEL_STORAGE_KEY,
  useAiModels,
  useChatRecord,
  useChats,
  useCreateChat,
  useDeleteChat,
} from './hooks'
import { Suggestions } from './MessageList'
import { ModelPicker } from './ModelPicker'
import type { ChatMessage } from './types'

/**
 * Props are the stable contract with the review screen (`PullRequestScreen`
 * mounts this and keeps it mounted while collapsed, so attached chips survive
 * the toggle; "Ask AI" re-opens the panel from the screen's bridge listener).
 */
export interface AiPanelProps {
  projectId: string
  number: number
  detail: PullRequestDetail
}

export const NO_PROVIDER_MESSAGE = 'No AI provider configured — add an API key in Setup'

/**
 * The AI panel (design.md §4): header with model picker, chat history, "New
 * chat" and "What does the AI see?"; the conversation; the composer with its
 * context chips. One persisted chat per PR is current at a time, remembered in
 * localStorage so a reload resumes it.
 */
export function AiPanel({ projectId, number, detail }: AiPanelProps) {
  const queryClient = useQueryClient()

  // --- Model -------------------------------------------------------------
  const models = useAiModels()
  const modelList = models.data ?? []
  const [storedModel, setStoredModel] = usePersistedState(MODEL_STORAGE_KEY, '', isString)
  const model = modelList.some((m) => m.id === storedModel) ? storedModel : (modelList[0]?.id ?? '')
  // The transport reads the model at send time, so the picker applies to the next turn.
  const modelRef = useRef(model)
  useEffect(() => {
    modelRef.current = model
  }, [model])
  const modelLabel = useCallback(
    (id: string) => modelList.find((m) => m.id === id)?.label ?? id,
    [modelList],
  )
  const noProvider = models.isSuccess && modelList.length === 0

  // --- Current chat ------------------------------------------------------
  const chats = useChats(projectId, number)
  const [storedChatId, setStoredChatId] = usePersistedState<string | null>(
    chatStorageKey(projectId, number),
    null,
    isNullableString,
  )
  // Resume the remembered chat, else the most recent one; a PR without chats starts in a draft.
  const chatId = storedChatId ?? chats.data?.[0]?.id ?? null
  const record = useChatRecord(projectId, number, chatId)
  useEffect(() => {
    if (storedChatId !== null && record.error && isNotFound(record.error)) setStoredChatId(null)
  }, [storedChatId, record.error, setStoredChatId])

  const createChat = useCreateChat(projectId, number)
  const deleteChat = useDeleteChat(projectId, number)
  const [actionError, setActionError] = useState<string | null>(null)

  // --- Live chat controls (from the mounted Conversation) ----------------
  const [controls, setControls] = useState<ChatControls | null>(null)
  const liveControls = controls && controls.chatId === chatId ? controls : null
  const streaming = liveControls?.status === 'submitted' || liveControls?.status === 'streaming'

  // A message sent before its chat existed (or finished loading) waits here.
  const [pendingParts, setPendingParts] = useState<ChatMessage['parts'] | null>(null)
  useEffect(() => {
    if (pendingParts && liveControls) {
      liveControls.send(pendingParts)
      setPendingParts(null)
    }
  }, [pendingParts, liveControls])
  useEffect(() => {
    if (pendingParts && chatId !== null && record.isError) {
      setPendingParts(null)
      setActionError(`Could not load the chat: ${errorMessage(record.error)}`)
    }
  }, [pendingParts, chatId, record.isError, record.error])

  const composer = useRef<ComposerHandle>(null)

  const handleSend = async (parts: ChatMessage['parts']) => {
    setActionError(null)
    if (liveControls) {
      liveControls.send(parts)
      return
    }
    if (chatId !== null) {
      // The chat exists but its Conversation has not mounted yet: send once it has.
      setPendingParts(parts)
      return
    }
    if (model === '') throw new Error(NO_PROVIDER_MESSAGE)
    const chat = await createChat.mutateAsync({ model })
    setStoredChatId(chat.id)
    setPendingParts(parts)
  }

  const handleNewChat = async () => {
    setActionError(null)
    try {
      const chat = await createChat.mutateAsync({ model })
      setStoredChatId(chat.id)
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this chat? Its messages are removed from this machine.')) return
    setActionError(null)
    try {
      await deleteChat.mutateAsync(id)
      if (id === storedChatId) setStoredChatId(null)
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  // After a turn: the record cache mirrors the live conversation; titles/updatedAt refresh.
  const handleTurnFinished = useCallback(
    (id: string, messages: ChatMessage[]) => {
      queryClient.setQueryData<ChatWithMessages>(aiKeys.chat(projectId, number, id), (prev) =>
        prev ? { ...prev, messages } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: aiKeys.chats(projectId, number) })
    },
    [queryClient, projectId, number],
  )

  // --- Static bits -------------------------------------------------------
  const paths = useMemo(() => detail.files.map((f) => f.path), [detail.files])
  const suggestions = useMemo(() => {
    const first = detail.files[0]?.path
    return [
      'Summarize what this PR changes and why',
      first ? `Walk me through ${first}` : 'Walk me through the changes',
      'Any risks or missing tests?',
    ]
  }, [detail.files])
  const onSuggest = useCallback((text: string) => composer.current?.insert(text), [])
  const [contextOpen, setContextOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-sm dark:bg-zinc-950">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-zinc-200 border-b px-2 dark:border-zinc-800">
        <h2 className="px-1 font-semibold text-zinc-900 dark:text-zinc-50">AI</h2>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <ModelPicker
            models={modelList}
            value={model}
            onChange={setStoredModel}
            disabled={models.isPending}
          />
          <HistoryMenu
            chats={chats.data}
            loading={chats.isPending}
            currentId={chatId}
            onSelect={setStoredChatId}
            onDelete={(id) => void handleDelete(id)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleNewChat()}
            disabled={noProvider || model === '' || createChat.isPending}
            title="Start a new chat for this pull request"
          >
            New chat
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="What does the AI see?"
            title="What does the AI see?"
            onClick={() => setContextOpen(true)}
          >
            <EyeIcon />
          </Button>
        </div>
      </header>

      {noProvider && (
        <div
          role="status"
          className="border-amber-200 border-b bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          No AI provider configured — add an API key in{' '}
          <Link to="/setup" className="font-medium underline">
            Setup
          </Link>
          . Reviewing works without it.
        </div>
      )}
      {models.isError && (
        <ErrorNotice
          className="m-2"
          title="Could not load models"
          message={errorMessage(models.error)}
          onRetry={() => void models.refetch()}
          retrying={models.isFetching}
        />
      )}
      {actionError && (
        <div className="m-2">
          <ErrorNotice title="Chat action failed" message={actionError} />
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {chatId === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {chats.isPending ? (
            <Spinner size="sm" label="Loading chats…" className="text-zinc-400" />
          ) : (
            <Suggestions suggestions={suggestions} onSuggest={onSuggest} />
          )}
        </div>
      ) : record.data ? (
        <Conversation
          key={chatId}
          projectId={projectId}
          number={number}
          record={record.data}
          paths={paths}
          modelRef={modelRef}
          onControls={setControls}
          onTurnFinished={handleTurnFinished}
          suggestions={suggestions}
          onSuggest={onSuggest}
          modelLabel={modelLabel}
        />
      ) : record.isError ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ErrorNotice
            title="Could not load this chat"
            message={errorMessage(record.error)}
            onRetry={() => void record.refetch()}
            retrying={record.isFetching}
          />
          {/* Creates and selects a fresh chat: merely forgetting the id would fall back to the
              most recent chat, i.e. re-select the one that just failed. */}
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => void handleNewChat()}
            disabled={noProvider || model === '' || createChat.isPending}
          >
            Start a new conversation
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-zinc-500">
          <Spinner size="sm" label="Loading chat…" />
        </div>
      )}

      <Composer
        ref={composer}
        onSend={handleSend}
        onStop={() => liveControls?.stop()}
        streaming={streaming}
        disabled={noProvider || models.isError || model === ''}
        disabledReason={noProvider ? NO_PROVIDER_MESSAGE : 'Loading models…'}
        busy={createChat.isPending || pendingParts !== null}
      />

      <ContextDialog
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        projectId={projectId}
        number={number}
      />
    </div>
  )
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4">
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
