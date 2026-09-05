import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../routes/http.js'
import { curatedModels } from '../secrets/providers.js'
import { MemorySecretStore } from '../secrets/store.js'
import type { SubscriptionProvider } from './providers.js'
import { defaultModelId, parseModelId, resolveLanguageModel } from './providers.js'

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}

const connectedSubscription = (): SubscriptionProvider => ({
  status: async () => ({ connected: true }),
  getFreshAccessToken: async () => ({ accessToken: 'tok' }),
  forceRefresh: async () => ({ accessToken: 'tok' }),
  defaultReasoningEffortFor: () => undefined,
  supportsReasoningEffort: async () => false,
})

describe('parseModelId', () => {
  it('accepts the chatgpt subscription slug ids', () => {
    for (const m of curatedModels('chatgpt')) {
      expect(parseModelId(m.id)).toEqual({ provider: 'chatgpt', modelId: m.modelId })
    }
    // The catalog, not a curated list, vouches for chatgpt slugs — any slug shape passes.
    expect(parseModelId('chatgpt:gpt-5.6-sol')).toEqual({
      provider: 'chatgpt',
      modelId: 'gpt-5.6-sol',
    })
  })

  it('rejects malformed ids and unknown providers with a 400', () => {
    for (const id of [
      '',
      'gpt-5',
      ':gpt-5',
      'chatgpt:',
      'gemini:pro',
      'openai:gpt-5',
      'anthropic:claude-sonnet-4-5',
      'chatgpt:../../etc/passwd',
      'custom-:chat',
      'custom-BAD:x',
    ]) {
      const err = thrown(() => parseModelId(id))
      expect(err, id).toBeInstanceOf(HttpError)
      expect(err, id).toMatchObject({ status: 400, code: 'bad_request' })
    }
  })

  it('names the accepted providers in the error', () => {
    const err = thrown(() => parseModelId('gemini:pro')) as HttpError
    expect(err.message).toContain('ChatGPT (subscription)')
  })
})

describe('parseModelId — custom providers', () => {
  const lookup = (id: string) =>
    id === 'custom-deepseek'
      ? {
          id,
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          apiFormat: 'openai' as const,
          models: [{ id: 'deepseek-chat' }],
        }
      : undefined

  it('accepts a custom provider id when the lookup vouches for it', () => {
    expect(parseModelId('custom-deepseek:deepseek-chat', lookup)).toEqual({
      provider: 'custom-deepseek',
      modelId: 'deepseek-chat',
    })
  })

  it('rejects unknown custom providers and malformed custom model ids', () => {
    for (const id of ['custom-nope:chat', 'custom-x:../../escape', 'custom-x:']) {
      const err = thrown(() => parseModelId(id, lookup))
      expect(err, id).toBeInstanceOf(HttpError)
      expect(err, id).toMatchObject({ status: 400 })
    }
  })
})

describe('resolveLanguageModel — chatgpt subscription', () => {
  it('answers 400 (code provider) when ChatGPT is not connected', async () => {
    const secrets = new MemorySecretStore()
    const err = await resolveLanguageModel('chatgpt:gpt-5.5', secrets).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 400, code: 'provider' })
  })

  it('resolves through the subscription when connected', async () => {
    const secrets = new MemorySecretStore()
    const model = await resolveLanguageModel('chatgpt:gpt-5.5', secrets, connectedSubscription())
    expect(model).toBeTruthy()
  })
})

describe('resolveLanguageModel — custom providers', () => {
  const deepseek = {
    id: 'custom-deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai' as const,
    models: [{ id: 'deepseek-chat' }],
  }

  it('resolves an openai-format custom provider against its base URL', async () => {
    const secrets = new MemorySecretStore()
    await secrets.set('custom-deepseek-api-key', 'sk-custom')
    const model = await resolveLanguageModel(
      'custom-deepseek:deepseek-chat',
      secrets,
      undefined,
      undefined,
      (id) => (id === 'custom-deepseek' ? deepseek : undefined),
    )
    expect(model).toBeTruthy()
  })

  it('answers 400 for a custom provider the lookup does not know', async () => {
    const secrets = new MemorySecretStore()
    const err = await resolveLanguageModel(
      'custom-ghost:chat',
      secrets,
      undefined,
      undefined,
      () => undefined,
    ).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 400 })
  })

  it('works keyless (local endpoints): no stored key still resolves', async () => {
    const secrets = new MemorySecretStore()
    const model = await resolveLanguageModel(
      'custom-deepseek:deepseek-chat',
      secrets,
      undefined,
      undefined,
      (id) => (id === 'custom-deepseek' ? deepseek : undefined),
    )
    expect(model).toBeTruthy()
  })
})

describe('defaultModelId', () => {
  it('is null with no subscription and defaults to chatgpt bootstrap when connected', async () => {
    expect(await defaultModelId(undefined)).toBeNull()
    const subscription = connectedSubscription()
    const spy = vi.spyOn(subscription, 'status')
    expect(await defaultModelId(subscription)).toBe('chatgpt:gpt-5.5')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
