import { useChat } from '@ai-sdk/react'
import { API_ROUTES, type ChatRequest, type ChatWithMessages } from '@coja/shared/api'
import { type ChatStatus, DefaultChatTransport } from 'ai'
import { type RefObject, useEffect, useMemo } from 'react'
import { MessageList } from './MessageList'
import { asChatMessages, type ChatMessage } from './types'

/** What the panel frame needs from the live chat to drive the composer. */
export interface ChatControls {
  chatId: string
  status: ChatStatus
  send(parts: ChatMessage['parts']): void
  stop(): void
}

export interface ConversationProps {
  projectId: string
  number: number
  /** The persisted chat this component was mounted for (mount keyed by `record.chat.id`). */
  record: ChatWithMessages
  paths: readonly string[]
  /** Read at send time, so the header's model picker applies to the next turn. */
  modelRef: RefObject<string>
  onControls(controls: ChatControls | null): void
  onTurnFinished(chatId: string, messages: ChatMessage[]): void
  suggestions: readonly string[]
  onSuggest(text: string): void
  modelLabel(id: string): string
}

/**
 * The SDK-driven part of the panel: one `useChat` per persisted chat. The
 * client sends the full UIMessage[] every turn (`ChatRequest`); the server
 * streams the assistant turn back and persists the whole conversation.
 */
export function Conversation({
  projectId,
  number,
  record,
  paths,
  modelRef,
  onControls,
  onTurnFinished,
  suggestions,
  onSuggest,
  modelLabel,
}: ConversationProps) {
  const chatId = record.chat.id
  const api = API_ROUTES.prChatMessages(projectId, number, chatId)
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, model: modelRef.current } satisfies ChatRequest,
        }),
      }),
    [api, modelRef],
  )
  // `messages` seeds the Chat once (the parent remounts us per chat id).
  const initialMessages = useMemo(() => asChatMessages(record.messages), [record.messages])

  const { messages, status, error, sendMessage, stop, regenerate, clearError } =
    useChat<ChatMessage>({
      id: chatId,
      messages: initialMessages,
      transport,
      throttle: 50,
      onFinish: ({ messages: all }) => onTurnFinished(chatId, all),
    })

  useEffect(() => {
    onControls({
      chatId,
      status,
      send: (parts) => void sendMessage({ role: 'user', parts }),
      stop: () => void stop(),
    })
  }, [chatId, status, sendMessage, stop, onControls])
  useEffect(() => () => onControls(null), [onControls])

  return (
    <MessageList
      messages={messages}
      status={status}
      error={error}
      onRetry={() => void regenerate()}
      onDismissError={clearError}
      paths={paths}
      suggestions={suggestions}
      onSuggest={onSuggest}
      modelLabel={modelLabel}
    />
  )
}
