import { z } from 'zod'
import type { Db } from './db.js'
import { settings } from './db.js'
import type {
  AddCustomProviderRequest,
  CustomApiFormat,
  CustomProviderConfig,
  CustomProviderModel,
} from './shared/api.js'

/**
 * User-added model providers (Setup → "Add model provider"): any endpoint
 * speaking the OpenAI chat-completions or Anthropic messages protocol at a
 * custom base URL. Configs live in the settings table as one JSON document —
 * a handful of entries at most, so a document beats a table — while API keys
 * go to the SecretStore under the provider id, exactly like built-in keys.
 */

const SETTINGS_KEY = 'custom_providers'

export const CUSTOM_PROVIDER_ID_PREFIX = 'custom-'

/**
 * Models arrive as ids, with an optional display name once one is known
 * (fetched from the endpoint's model list or edited in). Stored configs from
 * before labels existed hold plain strings — normalized on read.
 */
const modelEntrySchema = z.union([
  z
    .string()
    .transform((id) => ({ id: id.trim() }))
    .pipe(z.object({ id: z.string().min(1).max(200) })),
  z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200).optional(),
  }),
])

const normalizeModels = (models: CustomProviderModel[]): CustomProviderModel[] => {
  const seen = new Set<string>()
  const out: CustomProviderModel[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model.label ? { id: model.id, label: model.label } : { id: model.id })
  }
  return out
}

const modelsSchema = z
  .array(modelEntrySchema)
  .min(1, 'Add at least one model')
  .max(32)
  .transform(normalizeModels)

const configSchema = z.object({
  id: z.string().regex(/^custom-[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  apiFormat: z.enum(['openai', 'anthropic'] satisfies CustomApiFormat[]),
  models: modelsSchema,
})

export const addCustomProviderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64),
  baseUrl: z
    .string()
    .trim()
    .min(1, 'Base URL is required')
    .max(2000)
    .refine((value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    }, 'Base URL must be an http(s) URL'),
  apiFormat: z.enum(['openai', 'anthropic'] satisfies CustomApiFormat[]),
  models: modelsSchema,
  apiKey: z.string().max(4096).optional(),
})

/** `deepseek` / `My Proxy 2` → `deepseek` / `my-proxy-2` (the id is `custom-<slug>`). */
export function slugifyProviderName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'provider'
}

function readAll(db: Db): CustomProviderConfig[] {
  const raw = settings.get(db, SETTINGS_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: CustomProviderConfig[] = []
    for (const entry of parsed) {
      const result = configSchema.safeParse(entry)
      if (result.success) out.push(result.data)
    }
    return out
  } catch {
    return []
  }
}

function writeAll(db: Db, providers: CustomProviderConfig[]): void {
  settings.set(db, SETTINGS_KEY, JSON.stringify(providers))
}

export function listCustomProviders(db: Db): CustomProviderConfig[] {
  return readAll(db)
}

export function getCustomProvider(db: Db, id: string): CustomProviderConfig | undefined {
  return readAll(db).find((provider) => provider.id === id)
}

/**
 * Adds (or replaces — same id means an intentional edit) a custom provider
 * from a validated request. Returns the saved config (with its id) and the
 * new full list.
 */
export function saveCustomProvider(
  db: Db,
  request: AddCustomProviderRequest,
): { saved: CustomProviderConfig; providers: CustomProviderConfig[] } {
  const id = `${CUSTOM_PROVIDER_ID_PREFIX}${slugifyProviderName(request.name)}`
  const rest = readAll(db).filter((provider) => provider.id !== id)
  const saved: CustomProviderConfig = {
    id,
    name: request.name,
    baseUrl: request.baseUrl,
    apiFormat: request.apiFormat,
    models: normalizeModels(request.models.map((m) => (typeof m === 'string' ? { id: m } : m))),
  }
  writeAll(db, [...rest, saved])
  return { saved, providers: readAll(db) }
}

export function deleteCustomProvider(db: Db, id: string): boolean {
  const providers = readAll(db)
  const rest = providers.filter((provider) => provider.id !== id)
  if (rest.length === providers.length) return false
  writeAll(db, rest)
  return true
}
