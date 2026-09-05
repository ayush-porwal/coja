import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIALS_FILE,
  FileSecretStore,
  type KeyringModule,
  MemorySecretStore,
  openSecretStore,
  PROBE_ACCOUNT,
  providerKeyName,
} from './store.js'

const POSIX = process.platform !== 'win32'

let root: string
/** Does not exist yet when a test starts, so the store has to create it. */
let dataDir: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coja-secrets-'))
  dataDir = path.join(root, 'data')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const modeOf = async (p: string) => (await stat(p)).mode & 0o777
const readSecrets = async (file: string) =>
  (JSON.parse(await readFile(file, 'utf8')) as { version: number; secrets: Record<string, string> })
    .secrets

/** A keyring whose entries live in a Map; records every Entry construction. */
function fakeKeyring(opts: { failProbe?: Error } = {}) {
  const items = new Map<string, string>()
  const constructed: string[] = []
  class Entry {
    constructor(
      readonly service: string,
      readonly account: string,
    ) {
      constructed.push(`${service}/${account}`)
    }
    getPassword(): string | null {
      if (opts.failProbe && this.account === PROBE_ACCOUNT) throw opts.failProbe
      return items.get(this.account) ?? null
    }
    setPassword(password: string): void {
      items.set(this.account, password)
    }
    deletePassword(): boolean {
      return items.delete(this.account)
    }
  }
  const module: KeyringModule = { Entry }
  const load = vi.fn(async () => module)
  return { load, items, constructed }
}

describe('FileSecretStore', () => {
  it('answers null for a missing key without creating the file', async () => {
    const store = new FileSecretStore(dataDir)
    expect(store.backend).toBe('file')
    expect(await store.get('nope')).toBeNull()
    await expect(stat(store.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('round-trips set / get / overwrite / delete', async () => {
    const store = new FileSecretStore(dataDir)
    await store.set('openai-api-key', 'sk-one')
    expect(await store.get('openai-api-key')).toBe('sk-one')
    await store.set('openai-api-key', 'sk-two')
    expect(await store.get('openai-api-key')).toBe('sk-two')
    expect(await store.delete('openai-api-key')).toBe(true)
    expect(await store.get('openai-api-key')).toBeNull()
    expect(await store.delete('openai-api-key')).toBe(false)
  })

  it('writes the documented file shape', async () => {
    const store = new FileSecretStore(dataDir)
    await store.set('a', '1')
    expect(store.path).toBe(path.join(dataDir, CREDENTIALS_FILE))
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual({
      version: 1,
      secrets: { a: '1' },
    })
  })

  it.skipIf(!POSIX)(
    'creates the file with mode 0600 and the directory with mode 0700',
    async () => {
      const store = new FileSecretStore(dataDir)
      await store.set('a', '1')
      expect((await modeOf(store.path)).toString(8)).toBe('600')
      expect((await modeOf(dataDir)).toString(8)).toBe('700')
    },
  )

  it.skipIf(!POSIX)('tightens a pre-existing directory to 0700', async () => {
    const { mkdir, chmod } = await import('node:fs/promises')
    await mkdir(dataDir, { recursive: true })
    await chmod(dataDir, 0o755)
    await new FileSecretStore(dataDir).set('a', '1')
    expect((await modeOf(dataDir)).toString(8)).toBe('700')
  })

  it('rewrites atomically: other keys survive and no temp file is left behind', async () => {
    const store = new FileSecretStore(dataDir)
    await store.set('openai-api-key', 'sk-1')
    await store.set('anthropic-api-key', 'sk-ant-1')
    expect(await readSecrets(store.path)).toEqual({
      'openai-api-key': 'sk-1',
      'anthropic-api-key': 'sk-ant-1',
    })
    await store.delete('openai-api-key')
    expect(await readSecrets(store.path)).toEqual({ 'anthropic-api-key': 'sk-ant-1' })
    expect(await readdir(dataDir)).toEqual([CREDENTIALS_FILE])
  })

  it('serializes concurrent writes so none is lost', async () => {
    const store = new FileSecretStore(dataDir)
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => store.set(k, `v-${k}`)))
    expect(await readSecrets(store.path)).toEqual({
      a: 'v-a',
      b: 'v-b',
      c: 'v-c',
      d: 'v-d',
      e: 'v-e',
    })
    expect(await readdir(dataDir)).toEqual([CREDENTIALS_FILE])
  })

  it('refuses to read a corrupt file instead of silently discarding it', async () => {
    const store = new FileSecretStore(dataDir)
    await store.set('a', '1')
    await writeFile(store.path, '{ not json')
    await expect(store.get('a')).rejects.toThrow(/not a valid coja credentials file/)
    await writeFile(store.path, JSON.stringify({ version: 2, secrets: {} }))
    await expect(store.set('a', '2')).rejects.toThrow(/not a valid coja credentials file/)
    // The corrupt file was not replaced.
    expect(await readFile(store.path, 'utf8')).toBe(JSON.stringify({ version: 2, secrets: {} }))
  })

  it('rejects empty keys', async () => {
    const store = new FileSecretStore(dataDir)
    await expect(store.get('')).rejects.toThrow(/non-empty/)
    await expect(store.set('', 'x')).rejects.toThrow(/non-empty/)
    await expect(store.delete('')).rejects.toThrow(/non-empty/)
    await expect(new MemorySecretStore().get('')).rejects.toThrow(/non-empty/)
  })
})

describe('openSecretStore', () => {
  const base = () => ({ dataDir, platform: 'darwin' as const, env: {}, warn: vi.fn() })

  it("prefer: 'file' never touches the keyring", async () => {
    const keyring = fakeKeyring()
    const store = await openSecretStore({ ...base(), prefer: 'file', loadKeyring: keyring.load })
    expect(store.backend).toBe('file')
    expect(keyring.load).not.toHaveBeenCalled()
  })

  it('uses the keychain when the probe succeeds and delegates CRUD to Entry', async () => {
    const keyring = fakeKeyring()
    const opts = base()
    const store = await openSecretStore({ ...opts, prefer: 'auto', loadKeyring: keyring.load })
    expect(store.backend).toBe('keychain')
    expect(keyring.constructed).toEqual([`coja/${PROBE_ACCOUNT}`])
    expect(opts.warn).not.toHaveBeenCalled()

    expect(await store.get('openai-api-key')).toBeNull()
    await store.set('openai-api-key', 'sk-1')
    expect(keyring.items.get('openai-api-key')).toBe('sk-1')
    expect(await store.get('openai-api-key')).toBe('sk-1')
    expect(await store.delete('openai-api-key')).toBe(true)
    expect(await store.delete('openai-api-key')).toBe(false)
    expect(keyring.constructed.every((c) => c.startsWith('coja/'))).toBe(true)
    // Nothing was written to disk.
    await expect(stat(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it("prefer: 'auto' falls back to the file with one warning when the keychain is broken", async () => {
    const keyring = fakeKeyring({
      failProbe: new Error("Couldn't access platform storage: PermissionDenied\nmore detail"),
    })
    const opts = base()
    const store = await openSecretStore({ ...opts, prefer: 'auto', loadKeyring: keyring.load })
    expect(store.backend).toBe('file')
    expect(opts.warn).toHaveBeenCalledTimes(1)
    const message = opts.warn.mock.calls[0]?.[0] as string
    expect(message).toContain('OS keychain unavailable')
    expect(message).toContain("Couldn't access platform storage: PermissionDenied")
    expect(message).not.toContain('more detail')
    expect(message).toContain(path.join(dataDir, CREDENTIALS_FILE))
  })

  it("prefer: 'auto' falls back when the native module cannot even be loaded", async () => {
    const opts = base()
    const store = await openSecretStore({
      ...opts,
      prefer: 'auto',
      loadKeyring: async () => {
        throw new Error('Cannot find native binding')
      },
    })
    expect(store.backend).toBe('file')
    expect(opts.warn).toHaveBeenCalledTimes(1)
  })

  it("prefer: 'keychain' rethrows instead of falling back", async () => {
    const keyring = fakeKeyring({ failProbe: new Error('locked') })
    const opts = base()
    await expect(
      openSecretStore({ ...opts, prefer: 'keychain', loadKeyring: keyring.load }),
    ).rejects.toThrow('locked')
    expect(opts.warn).not.toHaveBeenCalled()
  })

  it('on Linux without a session bus, auto picks the file without loading the keyring', async () => {
    const keyring = fakeKeyring()
    const store = await openSecretStore({
      ...base(),
      platform: 'linux',
      env: {},
      prefer: 'auto',
      loadKeyring: keyring.load,
    })
    expect(store.backend).toBe('file')
    expect(keyring.load).not.toHaveBeenCalled()
  })

  it('on Linux with a session bus, auto tries the keychain', async () => {
    const keyring = fakeKeyring()
    const store = await openSecretStore({
      ...base(),
      platform: 'linux',
      env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
      prefer: 'auto',
      loadKeyring: keyring.load,
    })
    expect(store.backend).toBe('keychain')
  })

  it("on Linux without a session bus, an explicit 'keychain' preference still tries the keychain", async () => {
    const keyring = fakeKeyring()
    const store = await openSecretStore({
      ...base(),
      platform: 'linux',
      env: {},
      prefer: 'keychain',
      loadKeyring: keyring.load,
    })
    expect(store.backend).toBe('keychain')
  })

  it('reads the preference from COJA_CREDENTIAL_STORE when none is passed', async () => {
    const keyring = fakeKeyring()
    const store = await openSecretStore({
      ...base(),
      env: { COJA_CREDENTIAL_STORE: 'file' },
      loadKeyring: keyring.load,
    })
    expect(store.backend).toBe('file')
    expect(keyring.load).not.toHaveBeenCalled()
  })

  it('rejects an unknown preference', async () => {
    await expect(openSecretStore({ ...base(), prefer: 'cloud' })).rejects.toThrow(
      /COJA_CREDENTIAL_STORE must be one of auto, keychain, file/,
    )
  })
})

describe('MemorySecretStore', () => {
  it('round-trips and reports the requested backend', async () => {
    const store = new MemorySecretStore()
    expect(store.backend).toBe('keychain')
    expect(new MemorySecretStore('file').backend).toBe('file')
    expect(await store.get('k')).toBeNull()
    await store.set('k', 'v')
    expect(await store.get('k')).toBe('v')
    expect(await store.delete('k')).toBe(true)
    expect(await store.delete('k')).toBe(false)
  })
})

describe('providerKeyName', () => {
  it('derives the account name from the provider id', () => {
    expect(providerKeyName('openai')).toBe('openai-api-key')
    expect(providerKeyName('anthropic')).toBe('anthropic-api-key')
  })
})
