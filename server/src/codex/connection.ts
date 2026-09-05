import { type Db, settings } from '../db.js'
import type { SecretStore } from '../secrets/store.js'
import type { ChatGptConnectionStatus } from '../shared/api.js'
import { CodexError } from './errors.js'
import { type CodexCatalogModel, fetchModelCatalog } from './models.js'
import {
  type BrowserFlow,
  type CodexAuthRecord,
  extractMetadata,
  refreshAccessToken,
  startBrowserFlow,
  type TokenResponse,
} from './oauth.js'
import { CODEX_PROTOCOL, type CodexProtocol } from './protocol.js'

/**
 * The single ChatGPT connection of this coja instance. Tokens live only in
 * the SecretStore (OS keychain) under one key; the browser never receives
 * anything but connection status (connected, email, plan). Refreshes are
 * singleflight: concurrent turns join one in-flight refresh, and a terminal
 * refresh failure marks the connection auth-expired so later calls fail fast
 * without network until the user reconnects.
 */

export const CHATGPT_AUTH_KEY = 'chatgpt-auth'
/** Settings mirror of the last good model catalog (non-secret) for offline fallbacks. */
export const CHATGPT_CATALOG_KEY = 'chatgpt-model-catalog'
export const CATALOG_TTL_MS = 10 * 60 * 1000

/** Status facts plus whether a browser sign-in is currently open. */
export type ChatGptStatus = ChatGptConnectionStatus & { signingIn: boolean }

export interface ChatGptConnectDeps {
  secrets: SecretStore
  /** Optional settings DB: the last good model catalog is mirrored here (non-secret). */
  db?: Db
  /** Test seams; production callers leave these unset. */
  fetchImpl?: typeof fetch
  protocol?: CodexProtocol
  openBrowser?: (url: string) => void
  catalogTtlMs?: number
}

interface FreshToken {
  accessToken: string
  accountId?: string
}

export class ChatGptConnection {
  private readonly secrets: SecretStore
  private readonly protocol: CodexProtocol
  private readonly fetchImpl: typeof fetch
  private readonly openBrowser: (url: string) => void

  /** Read-through cache so chat turns do not hit the keychain on every call. */
  private cached: CodexAuthRecord | null | undefined
  private refreshPromise: Promise<FreshToken> | null = null
  private flow: BrowserFlow | null = null
  private catalog: CodexCatalogModel[] | null = null
  private catalogExpiresAt = 0
  private catalogPromise: Promise<CodexCatalogModel[]> | null = null
  private readonly db: Db | undefined
  private readonly catalogTtlMs: number
  private authExpired: { reason: string } | null = null
  private connectError: string | null = null

  constructor(deps: ChatGptConnectDeps) {
    this.secrets = deps.secrets
    this.db = deps.db
    this.catalogTtlMs = deps.catalogTtlMs ?? CATALOG_TTL_MS
    this.protocol = deps.protocol ?? CODEX_PROTOCOL
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.openBrowser =
      deps.openBrowser ??
      ((url) => {
        void import('../open-browser.js').then((m) => m.openBrowser(url))
      })
  }

  /** Status for the browser: never token material, just connection facts. */
  async status(): Promise<ChatGptStatus> {
    const signingIn = this.flow !== null
    const record = await this.load()
    if (!record) {
      return {
        connected: false,
        signingIn,
        ...(this.connectError ? { connectError: this.connectError } : {}),
      }
    }
    return {
      connected: true,
      signingIn,
      ...(record.email ? { email: record.email } : {}),
      ...(record.planType ? { plan: record.planType } : {}),
      ...(this.authExpired ? { authExpired: true } : {}),
    }
  }

  /**
   * Start the browser authorization flow. Resolves fast with the URL the
   * browser should open (the server also opens it); the flow completes in the
   * background and `status()` turns connected once the user approves.
   */
  async connect(): Promise<{ authUrl: string }> {
    if (this.flow) return { authUrl: this.flow.authUrl }
    this.connectError = null
    let flow: BrowserFlow
    try {
      flow = await startBrowserFlow({
        protocol: this.protocol,
        fetchImpl: this.fetchImpl,
        openBrowser: this.openBrowser,
      })
    } catch (err) {
      this.connectError = err instanceof Error ? err.message : String(err)
      throw err
    }
    this.flow = flow
    flow.completion.then(
      (tokens) => {
        if (this.flow === flow) this.flow = null
        return this.completeLogin(tokens)
      },
      (err: unknown) => {
        if (this.flow === flow) this.flow = null
        // A cancelled/timed-out login is a Setup-screen fact, not a chat error.
        this.connectError = err instanceof Error ? err.message : String(err)
      },
    )
    return { authUrl: flow.authUrl }
  }

  /** Forget tokens and any pending sign-in. There is no dependable upstream revoke. */
  async disconnect(): Promise<void> {
    this.flow?.cancel('disconnected')
    this.flow = null
    this.cached = null
    this.authExpired = null
    this.connectError = null
    this.refreshPromise = null
    await this.secrets.delete(CHATGPT_AUTH_KEY)
  }

  /**
   * A fresh access token for a chat turn, refreshing inside the margin.
   * Throws the typed `auth_expired` without network once the connection is
   * marked expired.
   */
  async getFreshAccessToken(): Promise<FreshToken> {
    if (this.authExpired) throw new CodexError('auth_expired', this.authExpired.reason)
    const record = await this.requireRecord()
    if (record.expiresAt - Date.now() >= this.protocol.refreshMarginMs) {
      return this.fresh(record)
    }
    return this.singleflightRefresh(false)
  }

  /** Force a refresh (singleflight); used by the transport after a 401. */
  async forceRefresh(): Promise<FreshToken> {
    if (this.authExpired) throw new CodexError('auth_expired', this.authExpired.reason)
    await this.requireRecord()
    return this.singleflightRefresh(true)
  }

  /**
   * The backend's model catalog for this account, cached for the TTL and
   * mirrored (non-secret) in the settings DB: when the endpoint is unreachable
   * the mirror keeps the picker alive. Shared singleflight so concurrent
   * pickers do one fetch.
   */
  async listModels(): Promise<CodexCatalogModel[]> {
    if (this.catalog && this.catalogExpiresAt > Date.now()) return this.catalog
    if (!this.catalogPromise) {
      this.catalogPromise = this.doFetchCatalog().finally(() => {
        this.catalogPromise = null
      })
    }
    return this.catalogPromise
  }

  /** The catalog's default effort for a model, from the cached catalog only (best effort). */
  defaultReasoningEffortFor(modelId: string): string | undefined {
    return this.catalog?.find((m) => m.slug === modelId)?.defaultReasoningEffort
  }

  /** Whether `effort` is in the model's catalog entry; fetches the catalog when stale. */
  async supportsReasoningEffort(modelId: string, effort: string): Promise<boolean> {
    const models = await this.listModels()
    const entry = models.find((m) => m.slug === modelId)
    return entry ? entry.reasoningEfforts.some((level) => level.effort === effort) : false
  }

  private async doFetchCatalog(): Promise<CodexCatalogModel[]> {
    try {
      const models = await fetchModelCatalog({
        fetchImpl: this.fetchImpl,
        protocol: this.protocol,
        getToken: () => this.getFreshAccessToken(),
        forceRefresh: () => this.forceRefresh(),
      })
      this.catalog = models
      this.catalogExpiresAt = Date.now() + this.catalogTtlMs
      this.mirrorCatalog(models)
      return models
    } catch (err) {
      const mirrored = this.mirroredCatalog()
      if (mirrored) {
        this.catalog = mirrored
        this.catalogExpiresAt = Date.now() + this.catalogTtlMs
        return mirrored
      }
      throw err
    }
  }

  private mirrorCatalog(models: CodexCatalogModel[]): void {
    if (!this.db) return
    try {
      settings.set(this.db, CHATGPT_CATALOG_KEY, JSON.stringify(models))
    } catch {
      // A mirror write must never break the happy path.
    }
  }

  private mirroredCatalog(): CodexCatalogModel[] | null {
    if (!this.db) return null
    try {
      const raw = settings.get(this.db, CHATGPT_CATALOG_KEY)
      return raw ? (JSON.parse(raw) as CodexCatalogModel[]) : null
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------

  private fresh(record: CodexAuthRecord): FreshToken {
    return {
      accessToken: record.accessToken,
      ...(record.accountId ? { accountId: record.accountId } : {}),
    }
  }

  private async requireRecord(): Promise<CodexAuthRecord> {
    const record = await this.load()
    if (!record) {
      throw new CodexError('auth_expired', 'ChatGPT is not connected — connect it in Setup.')
    }
    return record
  }

  private singleflightRefresh(force: boolean): Promise<FreshToken> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh(force).finally(() => {
        this.refreshPromise = null
      })
    }
    return this.refreshPromise
  }

  /**
   * The actual refresh. Reloads the record inside the promise (another turn
   * may have refreshed while this caller waited) and skips the margin re-check
   * only when the caller forces (a 401 retry). A forced refresh joins an
   * in-flight regular one and vice versa — one HTTP call either way. The old
   * refresh token is kept when the response omits one. Auth-expiry is marked
   * only on terminal failures — OAuth `invalid_*` or a bare 401/403, which
   * `tokenRequest` classifies; 429/5xx/network stay retryable.
   */
  private async doRefresh(force: boolean): Promise<FreshToken> {
    const current = await this.load()
    if (!current) {
      throw new CodexError('auth_expired', 'ChatGPT is not connected — connect it in Setup.')
    }
    if (!force && current.expiresAt - Date.now() >= this.protocol.refreshMarginMs) {
      // Another refresh landed while this caller waited for the singleflight.
      return this.fresh(current)
    }
    try {
      const tokens = await refreshAccessToken(
        { fetchImpl: this.fetchImpl, protocol: this.protocol },
        current.refreshToken,
      )
      const next: CodexAuthRecord = {
        ...current,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
        expiresAt: Date.now() + tokens.expires_in * 1000,
        ...extractMetadata(tokens),
      }
      await this.save(next)
      this.authExpired = null
      return this.fresh(next)
    } catch (err) {
      if (err instanceof CodexError && err.code === 'auth_expired') {
        this.authExpired = { reason: err.message }
      }
      throw err
    }
  }

  private async completeLogin(tokens: TokenResponse): Promise<void> {
    const next: CodexAuthRecord = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
      expiresAt: Date.now() + tokens.expires_in * 1000,
      ...extractMetadata(tokens),
    }
    await this.save(next)
    this.authExpired = null
    this.connectError = null
  }

  private async load(): Promise<CodexAuthRecord | null> {
    if (this.cached !== undefined) return this.cached
    const raw = await this.secrets.get(CHATGPT_AUTH_KEY)
    if (!raw) {
      this.cached = null
      return null
    }
    try {
      this.cached = JSON.parse(raw) as CodexAuthRecord
    } catch {
      this.cached = null
    }
    return this.cached
  }

  private async save(record: CodexAuthRecord): Promise<void> {
    await this.secrets.set(CHATGPT_AUTH_KEY, JSON.stringify(record))
    this.cached = record
  }
}
