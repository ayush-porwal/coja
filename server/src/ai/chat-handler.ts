import { HarnessInputError, handleChatTurn as runTurn } from '@coja/agent'
import type { LanguageModel } from 'ai'
import type { Db } from '../db.js'
import { badRequest } from '../routes/http.js'
import type { SecretStore } from '../secrets/store.js'
import type { Chat, GitChangedFile, PullRequestDetail } from '../shared/api.js'
import { deriveTitle, getChat, saveMessages } from './chats.js'
import {
  type CustomProviderSource,
  resolveLanguageModel,
  type SubscriptionProvider,
} from './providers.js'
import { applyGeneratedTitle, generateTitle } from './title.js'
import { reviewRepository, type ToolContext } from './tools.js'
import type { ChatMessage } from './types.js'

export { chipToText, MAX_OUTPUT_TOKENS, MAX_STEPS } from '@coja/agent'

export interface ChatTurnParams {
  db: Db
  secrets: SecretStore
  chat: Chat
  /** The full conversation as sent by the client (`ChatRequest.messages`), not yet validated. */
  messages: unknown[]
  /** `<provider>:<model id>` to answer with. */
  model: string
  toolContext: ToolContext
  detail: PullRequestDetail
  files: GitChangedFile[]
  /** Aborts the provider call and tool execution when the client disconnects. */
  signal: AbortSignal
  /** The connected ChatGPT subscription, when the user signed in. */
  subscription?: SubscriptionProvider
  /** Custom provider lookup (Setup's added endpoints), for model resolution. */
  customProviders?: CustomProviderSource
  /** Requested reasoning effort (validated upstream against the model's catalog entry). */
  reasoningEffort?: string
  /** Test seam: use this model instead of resolving `model` through the secret store. */
  languageModel?: LanguageModel
}

export async function handleChatTurn(params: ChatTurnParams): Promise<Response> {
  const { db, chat, model: modelId } = params
  let model = params.languageModel
  const getModel = async (): Promise<LanguageModel> => {
    model ??= await resolveLanguageModel(
      modelId,
      params.secrets,
      params.subscription,
      params.reasoningEffort,
      params.customProviders,
    )
    return model
  }
  try {
    return await runTurn({
      chat: { id: chat.id },
      messages: params.messages,
      model: modelId,
      detail: params.detail,
      files: params.files,
      signal: params.signal,
      languageModel: getModel,
      toolContext: { ...params.toolContext, git: reviewRepository },
      onFinish: (messages) => {
        const firstTurn = getChat(db, chat.id)?.chat.title == null
        saveMessages(db, chat.id, messages, { model: modelId })
        if (firstTurn && model) void refineTitle(db, chat.id, messages, model)
      },
    })
  } catch (error) {
    if (error instanceof HarnessInputError) throw badRequest(error.message)
    throw error
  }
}

/**
 * Name a first-turn chat with its own model. `saveMessages` already stored the
 * first-user-text fallback; the generated title replaces exactly that fallback
 * once it arrives. Fire-and-forget: a slow or failing naming call must never
 * delay or break the response that already streamed.
 */
async function refineTitle(
  db: Db,
  chatId: string,
  messages: ChatMessage[],
  model: LanguageModel,
): Promise<void> {
  try {
    const fallback = deriveTitle(messages)
    const generated = await generateTitle(model, messages)
    const applied = applyGeneratedTitle(db, chatId, generated, fallback)
    console.info(
      `coja: chat ${chatId} titled: generated=${JSON.stringify(generated)} fallback=${JSON.stringify(fallback)} applied=${applied}`,
    )
  } catch (err) {
    console.warn(`coja: title generation failed for chat ${chatId}:`, err)
  }
}
