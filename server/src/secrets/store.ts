import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ProviderId } from '../shared/api.js'

/**
 * Where API keys live. The OS keychain (macOS Keychain, Windows Credential
 * Manager, Secret Service on Linux) through `@napi-rs/keyring` when it works;
 * a 0600 JSON file in the data dir when it does not (headless Linux, a locked
 * or denied keychain, a missing native binary).
 *
 * Invariants: nothing else in the app writes a key to disk, no key is ever
 * logged, and no key is ever returned to the browser — routes only report
 * `configured: boolean`.
 */
export interface SecretStore {
  readonly backend: SecretBackend
  /** The stored value, or null when nothing is stored under `key`. */
  get(key: string): Promise<string | null>
  /** Store or overwrite. */
  set(key: string, value: string): Promise<void>
  /** True when a value existed and was removed; false when there was nothing to remove. */
  delete(key: string): Promise<boolean>
}

export type SecretBackend = 'keychain' | 'file'

/** Accepted values of `COJA_CREDENTIAL_STORE` / `openSecretStore({ prefer })`. */
export type StorePreference = 'auto' | 'keychain' | 'file'
const PREFERENCES: readonly StorePreference[] = ['auto', 'keychain', 'file']

/** Service of every keychain item coja writes (`security find-generic-password -s coja -a <key>`). */
export const KEYCHAIN_SERVICE = 'coja'
/** Account read once on open to check the store works. Never written, so it never appears in the keychain. */
export const PROBE_ACCOUNT = '__coja_probe__'
/** File name of the fallback store inside the data dir. */
export const CREDENTIALS_FILE = 'credentials.json'

/** Keychain account / file key under which a provider's API key is stored. */
export const providerKeyName = (provider: ProviderId): string => `${provider}-api-key`

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/** The subset of `@napi-rs/keyring` we use, so tests can inject a fake. */
export interface KeyringModule {
  Entry: new (
    service: string,
    account: string,
  ) => {
    getPassword(): string | null
    setPassword(password: string): void
    deletePassword(): boolean
  }
}

export interface OpenSecretStoreOptions {
  /** coja's data directory; the file backend writes `<dataDir>/credentials.json`. */
  dataDir: string
  /**
   * 'keychain' (fail if unavailable), 'file', or 'auto' (keychain when it
   * works, else file). Defaults to `COJA_CREDENTIAL_STORE`, then 'auto'.
   */
  prefer?: string
  /** Test seams; production callers leave these unset. */
  loadKeyring?: () => Promise<KeyringModule>
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  warn?: (message: string) => void
}

const loadNativeKeyring = (): Promise<KeyringModule> => import('@napi-rs/keyring')

export async function openSecretStore(opts: OpenSecretStoreOptions): Promise<SecretStore> {
  const env = opts.env ?? process.env
  const prefer = parsePreference(opts.prefer ?? env.COJA_CREDENTIAL_STORE ?? 'auto')
  const platform = opts.platform ?? process.platform
  const warn = opts.warn ?? ((message: string) => console.warn(message))
  const file = new FileSecretStore(opts.dataDir)

  if (prefer === 'file') return file
  if (prefer === 'auto' && platform === 'linux' && !env.DBUS_SESSION_BUS_ADDRESS) {
    // No session bus means no Secret Service. keyring-rs would silently fall
    // back to the kernel keyring, which is in-memory only, so a saved key would
    // vanish on reboot. The file is the honest choice on a headless box.
    return file
  }
  try {
    return await openKeychain(opts.loadKeyring ?? loadNativeKeyring)
  } catch (err) {
    if (prefer === 'keychain') throw err
    warn(
      `coja: OS keychain unavailable (${firstLine(err)}); storing API keys in ${file.path} (mode 0600)`,
    )
    return file
  }
}

function parsePreference(value: string): StorePreference {
  if ((PREFERENCES as readonly string[]).includes(value)) return value as StorePreference
  throw new Error(
    `COJA_CREDENTIAL_STORE must be one of ${PREFERENCES.join(', ')} (got ${JSON.stringify(value)})`,
  )
}

// ---------------------------------------------------------------------------
// Keychain backend
// ---------------------------------------------------------------------------

async function openKeychain(load: () => Promise<KeyringModule>): Promise<SecretStore> {
  // Throws "Cannot find native binding" when there is no prebuilt binary for this platform.
  const { Entry } = await load()
  const entry = (key: string) => new Entry(KEYCHAIN_SERVICE, key)
  // A working store answers null for an account nobody wrote. A locked, denied
  // or absent store throws — from the constructor on Linux, from the read on
  // macOS — and that is exactly the signal to fall back on.
  entry(PROBE_ACCOUNT).getPassword()

  return {
    backend: 'keychain',
    async get(key) {
      return entry(requireKey(key)).getPassword() ?? null
    },
    async set(key, value) {
      entry(requireKey(key)).setPassword(value)
    },
    async delete(key) {
      return entry(requireKey(key)).deletePassword()
    },
  }
}

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

const FileContents = z.object({
  version: z.literal(1),
  secrets: z.record(z.string(), z.string()),
})

/**
 * `<dataDir>/credentials.json`, `{ version: 1, secrets: { <key>: <value> } }`.
 * Every write goes to a temp file (mode 0600) that is renamed over the real
 * one, so a crash never leaves a half-written or world-readable file. Calls
 * are serialized within the process so concurrent sets cannot lose each other.
 */
export class FileSecretStore implements SecretStore {
  readonly backend = 'file' as const
  readonly path: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly dir: string) {
    this.path = path.join(dir, CREDENTIALS_FILE)
  }

  async get(key: string): Promise<string | null> {
    requireKey(key)
    return this.serialized(async () => (await this.load()).get(key) ?? null)
  }

  async set(key: string, value: string): Promise<void> {
    requireKey(key)
    return this.serialized(async () => {
      const secrets = await this.load()
      secrets.set(key, value)
      await this.save(secrets)
    })
  }

  async delete(key: string): Promise<boolean> {
    requireKey(key)
    return this.serialized(async () => {
      const secrets = await this.load()
      const had = secrets.delete(key)
      if (had) await this.save(secrets)
      return had
    })
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(noop, noop)
    return run
  }

  private async load(): Promise<Map<string, string>> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw err
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      throw this.corrupt()
    }
    const parsed = FileContents.safeParse(json)
    if (!parsed.success) throw this.corrupt()
    return new Map(Object.entries(parsed.data.secrets))
  }

  private corrupt(): Error {
    return new Error(
      `${this.path} is not a valid coja credentials file. Fix it, or delete it and re-enter your API keys.`,
    )
  }

  private async save(secrets: Map<string, string>): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    // `mkdir`'s mode only applies when it creates the directory; tighten an existing one too.
    await chmod(this.dir, 0o700).catch(noop)

    const body = `${JSON.stringify({ version: 1, secrets: Object.fromEntries(secrets) }, null, 2)}\n`
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, body, { mode: 0o600, flag: 'wx' })
      // writeFile's mode is subject to the umask; enforce 0600 before the file becomes visible.
      await chmod(tmp, 0o600)
      await rename(tmp, this.path)
    } catch (err) {
      await unlink(tmp).catch(noop)
      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory backend (tests)
// ---------------------------------------------------------------------------

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  constructor(readonly backend: SecretBackend = 'keychain') {}

  async get(key: string): Promise<string | null> {
    return this.values.get(requireKey(key)) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(requireKey(key), value)
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(requireKey(key))
  }
}

// ---------------------------------------------------------------------------

function requireKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('secret key must be a non-empty string')
  }
  return key
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n')[0] ?? message
}

function noop(): void {}
