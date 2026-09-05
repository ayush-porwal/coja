import { execFile as nodeExecFile } from 'node:child_process'
import { HttpError } from '../routes/http.js'
import type { GhAuthStatus } from '../shared/api.js'

/**
 * Thin wrapper over the GitHub CLI. Auth is exclusively `gh` (design.md,
 * "GitHub integration"): the token comes from `gh auth token`, login state from
 * `gh auth status`. No shell is ever involved (execFile with an argv array),
 * the token is never logged and never written to disk.
 */

/** Minimal execFile shape so tests can inject a fake. Rejects with the child_process error. */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

interface ExecError {
  code?: string | number
  stdout?: string
  stderr?: string
  message?: string
}

export const GH_NOT_FOUND =
  'GitHub CLI (gh) not found. Install it from https://cli.github.com and run `gh auth login`.'
export const NOT_LOGGED_IN = 'Not logged in to GitHub. Run `gh auth login` in your terminal.'

export const TOKEN_TTL_MS = 5 * 60 * 1000

const defaultExecFile: ExecFileFn = (file, args) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      file,
      [...args],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }))
        else resolve({ stdout, stderr })
      },
    )
  })

const isEnoent = (err: unknown): boolean => (err as ExecError | undefined)?.code === 'ENOENT'

const firstLine = (text: string | undefined): string | undefined => {
  const line = text?.split('\n').find((l) => l.trim() !== '')
  return line?.trim()
}

interface GhHostEntry {
  state?: string
  active?: boolean
  host?: string
  login?: string
}

/** Parse the JSON printed by `gh auth status --json hosts` into a GhAuthStatus. */
export function parseAuthStatus(stdout: string, host = 'github.com'): GhAuthStatus {
  let parsed: { hosts?: Record<string, GhHostEntry[] | undefined> } | null
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: `Could not read the GitHub CLI login state. ${NOT_LOGGED_IN}` }
  }
  const entries = parsed.hosts?.[host] ?? []
  const entry = entries.find((e) => e.active) ?? entries[0]
  if (!entry) return { ok: false, error: NOT_LOGGED_IN }
  if (entry.state === 'success' && entry.login) {
    return { ok: true, login: entry.login, host: entry.host ?? host }
  }
  const who = entry.login ? ` for ${entry.login}` : ''
  return {
    ok: false,
    error: `The GitHub CLI login${who} is not working (state: ${entry.state ?? 'unknown'}). Run \`gh auth login\` in your terminal.`,
  }
}

export interface GhCli {
  /** `gh auth status --json hosts` → whether the active github.com account works. Never throws. */
  authStatus(): Promise<GhAuthStatus>
  /** `gh auth token`, cached in memory for five minutes. Throws HttpError(401, gh_not_authenticated). */
  token(): Promise<string>
  /** Drop the cached token so the next `token()` asks gh again (used after a 401 from GitHub). */
  invalidateTokenCache(): void
}

export function createGhCli(
  deps: { execFile?: ExecFileFn; now?: () => number; host?: string } = {},
): GhCli {
  const execFile = deps.execFile ?? defaultExecFile
  const now = deps.now ?? Date.now
  const host = deps.host ?? 'github.com'
  let cached: { token: string; expiresAt: number } | undefined

  return {
    async authStatus() {
      let stdout: string
      try {
        // Exits 0 even when nobody is logged in (prints {"hosts":{}}); non-zero only when gh itself fails.
        ;({ stdout } = await execFile('gh', ['auth', 'status', '--json', 'hosts']))
      } catch (err) {
        if (isEnoent(err)) return { ok: false, error: GH_NOT_FOUND }
        const e = err as ExecError
        if (e.stdout?.trim().startsWith('{')) return parseAuthStatus(e.stdout, host)
        const detail = firstLine(e.stderr) ?? firstLine(e.message)
        return {
          ok: false,
          error: `Could not check the GitHub CLI login state${detail ? ` (${detail})` : ''}. Update gh (https://cli.github.com) and run \`gh auth login\` in your terminal.`,
        }
      }
      return parseAuthStatus(stdout, host)
    },

    async token() {
      if (cached && cached.expiresAt > now()) return cached.token
      let stdout: string
      try {
        ;({ stdout } = await execFile('gh', ['auth', 'token', '--hostname', host]))
      } catch (err) {
        if (isEnoent(err)) throw new HttpError(401, GH_NOT_FOUND, 'gh_not_authenticated')
        // stderr is gh's human message ("no oauth token found for github.com"); never a token.
        throw new HttpError(401, NOT_LOGGED_IN, 'gh_not_authenticated')
      }
      const token = stdout.trim()
      if (!token) throw new HttpError(401, NOT_LOGGED_IN, 'gh_not_authenticated')
      cached = { token, expiresAt: now() + TOKEN_TTL_MS }
      return token
    },

    invalidateTokenCache() {
      cached = undefined
    },
  }
}

const defaultCli = createGhCli()

export const ghAuthStatus = (): Promise<GhAuthStatus> => defaultCli.authStatus()
export const ghToken = (): Promise<string> => defaultCli.token()
export const invalidateTokenCache = (): void => defaultCli.invalidateTokenCache()
