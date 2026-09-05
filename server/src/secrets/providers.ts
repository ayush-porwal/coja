import type { ModelInfo } from '../shared/api.js'

/**
 * The ChatGPT subscription is the one non-key provider: users reach OpenAI
 * and Anthropic (and anything else) through custom endpoints (Setup →
 * "Add model provider"). This module keeps its display label and the short
 * bootstrap model list used when the backend's catalog cannot be reached.
 */

export const PROVIDER_LABELS: Record<'chatgpt', string> = {
  chatgpt: 'ChatGPT (subscription)',
}

/**
 * Bootstrap-only fallback: the picker is normally driven by the backend's
 * model catalog (`ChatGptConnection.listModels`), which is per-plan ground
 * truth. This list — slugs verified live on a Plus account, 2026-09-05 —
 * only covers a catalog outage before any mirror exists.
 */
const CURATED_CHATGPT: readonly { modelId: string; label: string }[] = [
  { modelId: 'gpt-5.5', label: 'GPT-5.5' },
  { modelId: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
]

export function curatedModels(provider: 'chatgpt'): ModelInfo[] {
  return CURATED_CHATGPT.map(({ modelId, label }) => ({
    id: `${provider}:${modelId}`,
    provider,
    modelId,
    label,
  }))
}
