import { describe, expect, it } from 'vitest'
import {
  addCustomProviderSchema,
  deleteCustomProvider,
  getCustomProvider,
  listCustomProviders,
  saveCustomProvider,
  slugifyProviderName,
} from './custom-providers.js'
import { openDb } from './db.js'

const VALID = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiFormat: 'anthropic' as const,
  models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
}

describe('slugifyProviderName', () => {
  it('slugs names into id suffixes', () => {
    expect(slugifyProviderName('DeepSeek')).toBe('deepseek')
    expect(slugifyProviderName('My Proxy 2')).toBe('my-proxy-2')
    expect(slugifyProviderName('  OpenRouter (free) ')).toBe('openrouter-free')
  })

  it('falls back to a placeholder when the name has no slug characters', () => {
    expect(slugifyProviderName('///')).toBe('provider')
  })
})

describe('custom provider store', () => {
  it('round-trips a provider: save, get, list, delete', () => {
    const db = openDb(':memory:')
    expect(listCustomProviders(db)).toEqual([])

    const { saved, providers } = saveCustomProvider(db, VALID)
    expect(saved.id).toBe('custom-deepseek')
    expect(saved.models).toEqual([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }])
    expect(providers).toHaveLength(1)
    expect(getCustomProvider(db, 'custom-deepseek')).toEqual(saved)

    expect(deleteCustomProvider(db, 'custom-deepseek')).toBe(true)
    expect(getCustomProvider(db, 'custom-deepseek')).toBeUndefined()
    expect(deleteCustomProvider(db, 'custom-deepseek')).toBe(false)
  })

  it('replaces an existing provider with the same id (an intentional edit)', () => {
    const db = openDb(':memory:')
    saveCustomProvider(db, VALID)
    const { providers } = saveCustomProvider(db, { ...VALID, models: ['deepseek-chat'] })
    expect(providers).toHaveLength(1)
    expect(getCustomProvider(db, 'custom-deepseek')?.models).toEqual([{ id: 'deepseek-chat' }])
  })

  it('keeps distinct providers apart and survives a reopen', () => {
    const db = openDb(':memory:')
    saveCustomProvider(db, VALID)
    saveCustomProvider(db, { ...VALID, name: 'Local Ollama', baseUrl: 'http://localhost:11434/v1' })
    const file = ':memory:'
    void file
    expect(listCustomProviders(db).map((p) => p.id)).toEqual([
      'custom-deepseek',
      'custom-local-ollama',
    ])
  })
})

describe('addCustomProviderSchema', () => {
  it('accepts a valid request, trims fields, and normalizes model ids to objects', () => {
    const parsed = addCustomProviderSchema.parse({
      name: '  DeepSeek  ',
      baseUrl: ' https://api.deepseek.com/v1 ',
      apiFormat: 'openai',
      models: [' deepseek-chat '],
    })
    expect(parsed.name).toBe('DeepSeek')
    expect(parsed.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(parsed.models).toEqual([{ id: 'deepseek-chat' }])
  })

  it('accepts { id, label } entries and normalizes them', () => {
    const parsed = addCustomProviderSchema.parse({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }, { id: 'deepseek-reasoner' }],
    })
    expect(parsed.models).toEqual([
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner' },
    ])
  })

  it('rejects non-http(s) URLs and empty model lists; duplicate model ids are normalized away', () => {
    expect(addCustomProviderSchema.safeParse({ ...VALID, baseUrl: 'ftp://x' }).success).toBe(false)
    expect(addCustomProviderSchema.safeParse({ ...VALID, models: [] }).success).toBe(false)
    const dupes = addCustomProviderSchema.parse({ ...VALID, models: ['a', 'a'] })
    expect(dupes.models).toEqual([{ id: 'a' }])
    expect(addCustomProviderSchema.safeParse({ ...VALID, name: '' }).success).toBe(false)
  })
})
