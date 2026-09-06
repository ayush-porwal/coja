import type { ChatWithMessages, PullRequestDetail } from '@coja/shared/api'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BrandLoader } from '../../brand/BrandLoader'
import { useTheme } from '../../themes/ThemeContext'
import { ConfirmDialog, ErrorNotice } from '../../ui'
import { errorMessage } from '../errors'
import { usePersistedState } from '../usePersistedState'
import { Composer, type ComposerHandle } from './Composer'
import { ContextDialog } from './ContextDialog'
import { type ChatControls, Conversation } from './Conversation'
import { chatTitle, HistoryMenu } from './HistoryMenu'
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
import { EffortPicker, ModelPicker } from './ModelPicker'
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
  /** Notified when the composer's attached-chip count changes (collapsed-panel badge). */
  onChipsChange?: (count: number) => void
}

export const NO_PROVIDER_MESSAGE = 'No model provider configured — add one in Setup'

/**
 * After a first turn the server names the chat with its own model, a beat
 * after the conversation is persisted; these refetches pick the name up.
 */
export const TITLE_REFETCH_DELAYS_MS = [1500, 5000]

/**
 * The chat sidepanel (design.md §4): header with model picker, reasoning
 * effort, chat history and new chat; the conversation; the composer with its
 * context chips. One persisted chat per PR is current at a time, remembered in
 * localStorage so a reload resumes it.
 */
export function AiPanel({ projectId, number, detail, onChipsChange }: AiPanelProps) {
  const queryClient = useQueryClient()
  const { palette, appearance } = useTheme()

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

  // --- Reasoning effort (ChatGPT subscription catalog) --------------------
  const currentModel = modelList.find((m) => m.id === model)
  const effortOptions = currentModel?.reasoningEfforts ?? []
  const [effort, setEffort] = useState<string | null>(null)
  const effortRef = useRef<string | null>(null)
  // A model switch resets the effort to that model's catalog default.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the picked model id changes
  useEffect(() => {
    setEffort(currentModel?.defaultReasoningEffort ?? null)
  }, [model])
  useEffect(() => {
    effortRef.current = effort
  }, [effort])
  // When a subscription model is active and a key-billing model exists, the chat
  // error notice can offer an explicit one-click switch to it (never automatic).
  const apiFallbackModel = model.startsWith('chatgpt:')
    ? (modelList.find((m) => m.provider !== 'chatgpt')?.id ?? null)
    : null

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
  // Set by the history menu; the confirm modal below performs the deletion.
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null)

  // --- Live chat controls (from the mounted Conversation) ----------------
  const [controls, setControls] = useState<ChatControls | null>(null)
  const liveControls = controls && controls.chatId === chatId ? controls : null
  const streaming = liveControls?.status === 'submitted' || liveControls?.status === 'streaming'

  // A message sent before its chat was ready waits here — tied to the chat it
  // was sent to, so switching conversations discards it instead of delivering
  // it to the wrong one.
  const [pending, setPending] = useState<{ chatId: string; parts: ChatMessage['parts'] } | null>(
    null,
  )
  useEffect(() => {
    if (pending && liveControls && pending.chatId === chatId) {
      liveControls.send(pending.parts)
      setPending(null)
    }
  }, [pending, liveControls, chatId])
  useEffect(() => {
    if (pending && chatId !== null && chatId !== pending.chatId) setPending(null)
  }, [pending, chatId])
  useEffect(() => {
    if (pending && chatId !== null && record.isError) {
      setPending(null)
      setActionError(`Could not load the chat: ${errorMessage(record.error)}`)
    }
  }, [pending, chatId, record.isError, record.error])

  const composer = useRef<ComposerHandle>(null)

  const handleSend = useCallback(
    async (parts: ChatMessage['parts']) => {
      setActionError(null)
      if (liveControls) {
        liveControls.send(parts)
        return
      }
      if (chatId !== null) {
        // The chat exists but its Conversation has not mounted yet: send once it has.
        setPending({ chatId, parts })
        return
      }
      if (model === '') throw new Error(NO_PROVIDER_MESSAGE)
      const chat = await createChat.mutateAsync({ model })
      setStoredChatId(chat.id)
      setPending({ chatId: chat.id, parts })
    },
    [liveControls, chatId, model, createChat, setStoredChatId],
  )

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
      for (const delay of TITLE_REFETCH_DELAYS_MS) {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: aiKeys.chats(projectId, number) })
        }, delay)
      }
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
  /** A suggestion pill sends straight away — one click, one message. */
  const sendSuggestion = useCallback(
    (text: string) => {
      if (model === '' || noProvider) return
      void handleSend([{ type: 'text', text }])
    },
    [handleSend, model, noProvider],
  )
  const [contextOpen, setContextOpen] = useState(false)
  const currentChat = chats.data?.find((c) => c.id === chatId)
  const currentTitle = currentChat ? chatTitle(currentChat) : 'New conversation'

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-sm">
      <header className="flex h-10 shrink-0 items-center gap-1 border-edge border-b px-2">
        <h2
          className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted"
          title={currentTitle}
        >
          {currentTitle}
        </h2>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setContextOpen(true)}
            title="Context & tools"
            aria-label="Context and tools"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink"
          >
            <EyeIcon />
          </button>
          <HistoryMenu
            chats={chats.data}
            loading={chats.isPending}
            currentId={chatId}
            onSelect={setStoredChatId}
            onDelete={setDeleteChatId}
          />
          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={noProvider || model === '' || createChat.isPending}
            title="New chat"
            aria-label="New chat"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <NewChatIcon />
          </button>
        </div>
      </header>

      {noProvider && (
        <div
          role="status"
          className="border-caution border-b bg-caution-soft px-3 py-2 text-xs text-caution"
        >
          No model provider configured — add one in{' '}
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
        </div>
      )}

      {chatId === null ? (
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3">
          {chats.isPending ? (
            <div className="flex justify-center py-6">
              <BrandLoader
                paletteId={palette.id}
                appearance={appearance}
                size="medium"
                label="Loading chats…"
              />
            </div>
          ) : (
            <Suggestions suggestions={suggestions} onSuggest={sendSuggestion} />
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
          reasoningEffortRef={effortRef}
          onControls={setControls}
          onTurnFinished={handleTurnFinished}
          suggestions={suggestions}
          onSuggest={sendSuggestion}
          modelLabel={modelLabel}
          apiFallbackModel={apiFallbackModel}
          onSwitchModel={setStoredModel}
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
          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={noProvider || model === '' || createChat.isPending}
            className="mt-2 rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium hover:bg-hover disabled:opacity-50"
          >
            Start a new conversation
          </button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <BrandLoader
            paletteId={palette.id}
            appearance={appearance}
            size="medium"
            label="Loading chat…"
          />
        </div>
      )}

      <Composer
        ref={composer}
        actions={
          <>
            <ModelPicker
              models={modelList}
              value={model}
              onChange={setStoredModel}
              disabled={models.isPending}
            />
            <EffortPicker efforts={effortOptions} value={effort} onChange={setEffort} />
          </>
        }
        onSend={handleSend}
        onStop={() => liveControls?.stop()}
        streaming={streaming}
        disabled={noProvider || models.isError || model === ''}
        disabledReason={noProvider ? NO_PROVIDER_MESSAGE : 'Loading models…'}
        busy={createChat.isPending || pending !== null}
        onChipsChange={onChipsChange}
      />

      <ContextDialog
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        projectId={projectId}
        number={number}
      />

      <ConfirmDialog
        open={deleteChatId !== null}
        title="Delete this chat?"
        description="Its messages are removed from this machine. This cannot be undone."
        confirmLabel="Delete"
        icon="trash"
        busy={deleteChat.isPending}
        onConfirm={() => {
          if (deleteChatId !== null) void handleDelete(deleteChatId)
          setDeleteChatId(null)
        }}
        onCancel={() => setDeleteChatId(null)}
      />
    </div>
  )
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
