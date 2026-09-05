import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../routes/http.js'
import {
  createGhCli,
  type ExecFileFn,
  GH_NOT_FOUND,
  NOT_LOGGED_IN,
  parseAuthStatus,
  TOKEN_TTL_MS,
} from './gh-cli.js'

const LOGGED_IN = JSON.stringify({
  hosts: {
    'github.com': [
      {
        state: 'success',
        active: true,
        host: 'github.com',
        login: 'ayush-porwal',
        tokenSource: 'keyring',
        scopes: 'admin:public_key, gist, read:org, repo',
        gitProtocol: 'ssh',
      },
    ],
  },
})

const enoent = () => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
const exitError = (stderr: string, stdout = '') =>
  Object.assign(new Error('Command failed: gh'), { code: 1, stdout, stderr })

describe('parseAuthStatus', () => {
  it('reports the active github.com login', () => {
    expect(parseAuthStatus(LOGGED_IN)).toEqual({
      ok: true,
      login: 'ayush-porwal',
      host: 'github.com',
    })
  })

  it('prefers the active account when several are logged in', () => {
    const json = JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: false, host: 'github.com', login: 'other' },
          { state: 'success', active: true, host: 'github.com', login: 'me' },
        ],
      },
    })
    expect(parseAuthStatus(json)).toMatchObject({ ok: true, login: 'me' })
  })

  it('is not ok when nobody is logged in', () => {
    expect(parseAuthStatus('{"hosts":{}}')).toEqual({ ok: false, error: NOT_LOGGED_IN })
    expect(parseAuthStatus('{}')).toEqual({ ok: false, error: NOT_LOGGED_IN })
  })

  it('is not ok when the active login is broken', () => {
    const json = JSON.stringify({
      hosts: { 'github.com': [{ state: 'error', active: true, host: 'github.com', login: 'me' }] },
    })
    const status = parseAuthStatus(json)
    expect(status.ok).toBe(false)
    expect(status.error).toContain('for me')
    expect(status.error).toContain('gh auth login')
  })

  it('ignores other hosts', () => {
    const json = JSON.stringify({
      hosts: { 'ghe.example.com': [{ state: 'success', active: true, login: 'me' }] },
    })
    expect(parseAuthStatus(json)).toEqual({ ok: false, error: NOT_LOGGED_IN })
  })

  it('handles garbage output', () => {
    expect(parseAuthStatus('not json').ok).toBe(false)
    expect(parseAuthStatus('null').ok).toBe(false)
  })
})

describe('createGhCli', () => {
  it('authStatus runs gh without a shell and parses the JSON', async () => {
    const execFile = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: LOGGED_IN, stderr: '' })
    const cli = createGhCli({ execFile })
    await expect(cli.authStatus()).resolves.toMatchObject({ ok: true, login: 'ayush-porwal' })
    expect(execFile).toHaveBeenCalledWith('gh', ['auth', 'status', '--json', 'hosts'])
  })

  it('authStatus explains a missing gh binary', async () => {
    const execFile = vi.fn<ExecFileFn>().mockRejectedValue(enoent())
    await expect(createGhCli({ execFile }).authStatus()).resolves.toEqual({
      ok: false,
      error: GH_NOT_FOUND,
    })
  })

  it('authStatus still parses JSON printed by a non-zero exit', async () => {
    const execFile = vi.fn<ExecFileFn>().mockRejectedValue(exitError('', '{"hosts":{}}'))
    await expect(createGhCli({ execFile }).authStatus()).resolves.toEqual({
      ok: false,
      error: NOT_LOGGED_IN,
    })
  })

  it('authStatus surfaces gh failures without claiming a login state it cannot know', async () => {
    const execFile = vi.fn<ExecFileFn>().mockRejectedValue(exitError('unknown flag: --json\n'))
    const status = await createGhCli({ execFile }).authStatus()
    expect(status.ok).toBe(false)
    expect(status.error).toContain('unknown flag: --json')
    expect(status.error).toContain('gh auth login')
  })

  it('token trims the output and caches it for five minutes', async () => {
    let now = 1_000_000
    const execFile = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: 'gho_secret\n', stderr: '' })
    const cli = createGhCli({ execFile, now: () => now })

    await expect(cli.token()).resolves.toBe('gho_secret')
    await expect(cli.token()).resolves.toBe('gho_secret')
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(execFile.mock.calls[0]?.[0]).toBe('gh')
    expect(execFile.mock.calls[0]?.[1].slice(0, 2)).toEqual(['auth', 'token'])

    now += TOKEN_TTL_MS - 1
    await cli.token()
    expect(execFile).toHaveBeenCalledTimes(1)

    now += 2
    await cli.token()
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('invalidateTokenCache forces the next token() to ask gh again', async () => {
    const execFile = vi.fn<ExecFileFn>().mockResolvedValue({ stdout: 'tok', stderr: '' })
    const cli = createGhCli({ execFile })
    await cli.token()
    cli.invalidateTokenCache()
    await cli.token()
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('token maps gh failures to a 401 with the gh_not_authenticated code', async () => {
    const notLoggedIn = createGhCli({
      execFile: vi.fn<ExecFileFn>().mockRejectedValue(exitError('no oauth token found')),
    })
    const err = await notLoggedIn.token().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 401, code: 'gh_not_authenticated', message: NOT_LOGGED_IN })

    const missing = createGhCli({ execFile: vi.fn<ExecFileFn>().mockRejectedValue(enoent()) })
    await expect(missing.token()).rejects.toMatchObject({ status: 401, message: GH_NOT_FOUND })

    const empty = createGhCli({
      execFile: vi.fn<ExecFileFn>().mockResolvedValue({ stdout: '\n', stderr: '' }),
    })
    await expect(empty.token()).rejects.toMatchObject({ status: 401 })
  })

  it('never puts the token in an error message', async () => {
    const execFile = vi.fn<ExecFileFn>().mockRejectedValue(exitError('boom gho_leaked'))
    const err = (await createGhCli({ execFile })
      .token()
      .catch((e: unknown) => e)) as Error
    expect(err.message).not.toContain('gho_leaked')
  })
})
