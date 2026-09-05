import { describe, expect, it } from 'vitest'
import { curatedModels, PROVIDER_LABELS } from './providers.js'

describe('curatedModels (chatgpt bootstrap list)', () => {
  it('returns chatgpt-scoped wire ids', () => {
    const models = curatedModels('chatgpt')
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.id).toBe(`chatgpt:${model.modelId}`)
      expect(model.provider).toBe('chatgpt')
      expect(model.label).not.toBe('')
    }
  })

  it('starts with the plan-verified default', () => {
    expect(curatedModels('chatgpt')[0]?.id).toBe('chatgpt:gpt-5.5')
  })

  it('labels the subscription provider', () => {
    expect(PROVIDER_LABELS.chatgpt).toBe('ChatGPT (subscription)')
  })
})
