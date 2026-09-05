import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { badRequest, HttpError } from '../routes/http.js'
import { curatedModels, PROVIDER_LABELS } from '../secrets/providers.js'
import { providerKeyName, type SecretStore } from '../secrets/store.js'
import { PROVIDERS, type ProviderId } from '../shared/api.js'

/**
 * Model ids on the wire are `<provider>:<model id>` (`ModelInfo.id`). This
 * module turns one into a Vercel AI SDK language model, reading the API key
 * from the secret store at call time so a key saved in Setup is used by the
 * very next turn. Keys never leave this process except in the provider call.
 */

/**
 * Split and check a wire model id. Only curated ids pass (HTTP 400 otherwise,
 * listing what is accepted): the model id is forwarded to the provider, so an
 * arbitrary string is not something to relay, and the picker never offers
 * anything but curated ids anyway.
 */
export function parseModelId(id: string): { provider: ProviderId; modelId: string } {
  const colon = id.indexOf(':')
  if (colon <= 0 || colon === id.length - 1) {
    throw badRequest(`invalid model id "${id}": expected <provider>:<model id>`)
  }
  const provider = id.slice(0, colon)
  if (!isProviderId(provider)) {
    throw badRequest(`unknown model provider "${provider}" (expected ${PROVIDERS.join(' or ')})`)
  }
  const modelId = id.slice(colon + 1)
  const accepted = curatedModels(provider)
  if (!accepted.some((m) => m.modelId === modelId)) {
    throw badRequest(
      `unknown ${PROVIDER_LABELS[provider]} model "${id}"; accepted: ${accepted.map((m) => m.id).join(', ')}`,
    )
  }
  return { provider, modelId }
}

export async function resolveLanguageModel(
  id: string,
  secrets: SecretStore,
): Promise<LanguageModel> {
  const { provider, modelId } = parseModelId(id)
  const apiKey = await secrets.get(providerKeyName(provider))
  if (!apiKey) {
    throw new HttpError(
      400,
      `No API key configured for ${PROVIDER_LABELS[provider]}. Add one in Setup.`,
      'provider',
    )
  }
  return provider === 'openai'
    ? createOpenAI({ apiKey })(modelId)
    : createAnthropic({ apiKey })(modelId)
}

/** The first curated model of the first configured provider (OpenAI before Anthropic), or null when no key is stored. */
export async function defaultModelId(secrets: SecretStore): Promise<string | null> {
  for (const provider of PROVIDERS) {
    if (await secrets.get(providerKeyName(provider))) {
      return curatedModels(provider)[0]?.id ?? null
    }
  }
  return null
}

const isProviderId = (value: string): value is ProviderId =>
  (PROVIDERS as readonly string[]).includes(value)
