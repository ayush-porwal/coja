import { describe, expect, it } from 'vitest'
import { HttpError } from '../routes/http.js'
import { curatedModels } from '../secrets/providers.js'
import { MemorySecretStore, providerKeyName } from '../secrets/store.js'
import { PROVIDERS } from '../shared/api.js'
import { defaultModelId, parseModelId, resolveLanguageModel } from './providers.js'

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}

describe('parseModelId', () => {
  it('accepts exactly the curated ids of both providers', () => {
    for (const provider of PROVIDERS) {
      const curated = curatedModels(provider)
      expect(curated.length).toBeGreaterThan(0)
      for (const m of curated) {
        expect(parseModelId(m.id)).toEqual({ provider, modelId: m.modelId })
      }
    }
  })

  it('rejects malformed ids, unknown providers and models outside the curated list with a 400', () => {
    for (const id of [
      '',
      'gpt-5',
      ':gpt-5',
      'openai:',
      'gemini:pro',
      'OpenAI:gpt-5',
      'openai:GPT-5',
      'openai:gpt-5 ',
      'openai: gpt-5',
      'openai:gpt-5-mini-2025-08-07',
      'anthropic:claude-3-opus',
      'anthropic:claude-sonnet-4-5-20250929',
      'openai:../../etc/passwd',
    ]) {
      const err = thrown(() => parseModelId(id))
      expect(err, id).toBeInstanceOf(HttpError)
      expect(err, id).toMatchObject({ status: 400, code: 'bad_request' })
    }
  })

  it('names the accepted ids of that provider in the error', () => {
    expect(() => parseModelId('openai:gpt-9')).toThrow(
      /unknown OpenAI model "openai:gpt-9"; accepted: openai:gpt-5, openai:gpt-5-mini, /,
    )
    const anthropic = thrown(() => parseModelId('anthropic:claude-9')) as Error
    expect(anthropic.message).toContain('anthropic:claude-sonnet-4-5')
    expect(anthropic.message).not.toContain('openai:')
  })
})

describe('resolveLanguageModel and defaultModelId', () => {
  it('answers 400 (code provider) without a key, and 400 (bad_request) for an unknown model even with one', async () => {
    const secrets = new MemorySecretStore()
    await expect(resolveLanguageModel('openai:gpt-5-mini', secrets)).rejects.toMatchObject({
      status: 400,
      code: 'provider',
      message: 'No API key configured for OpenAI. Add one in Setup.',
    })
    await secrets.set(providerKeyName('openai'), 'sk-test')
    await expect(resolveLanguageModel('openai:gpt-9', secrets)).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
    })
    // A curated model with a key resolves to a model object; no request is made until it is used.
    const model = await resolveLanguageModel('openai:gpt-5-mini', secrets)
    expect(model).toMatchObject({ modelId: 'gpt-5-mini' })
  })

  it('defaults to the first curated model of the first configured provider', async () => {
    const secrets = new MemorySecretStore()
    expect(await defaultModelId(secrets)).toBeNull()
    await secrets.set(providerKeyName('anthropic'), 'sk-ant')
    expect(await defaultModelId(secrets)).toBe('anthropic:claude-sonnet-4-5')
    await secrets.set(providerKeyName('openai'), 'sk-oai')
    expect(await defaultModelId(secrets)).toBe('openai:gpt-5')
  })
})
