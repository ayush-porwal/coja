import { execFile } from 'node:child_process'
import { badRequest } from '../routes/http.js'

/**
 * The only module that spawns git.
 *
 * Every invocation is `execFile('git', argv)` — an argv array, never a shell —
 * with prompts disabled and stable, untranslated output. Callers hand over
 * arguments as data; pathspecs are validated with {@link assertPathspec} and
 * always placed after a `--`, revisions with {@link assertRevision}, so no
 * user-controlled string can ever be read as an option.
 */

/** 64 MiB: enough for any patch or file we are willing to hold in memory. */
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

/** Stderr kept on a GitError is capped so a runaway process cannot bloat error responses. */
const MAX_STDERR_CHARS = 4000

export interface RunGitOptions {
  /** Cap on stdout bytes (default {@link DEFAULT_MAX_BUFFER}). */
  maxBuffer?: number
  /** Kill git after this many milliseconds (0 or undefined: no limit). */
  timeoutMs?: number
  signal?: AbortSignal
  /** Extra environment variables. The fixed ones below always win. */
  env?: NodeJS.ProcessEnv
  /** Non-zero exit codes that are not failures (e.g. `git grep` exits 1 when nothing matches). */
  okExitCodes?: readonly number[]
  /**
   * When stdout exceeds `maxBuffer`, resolve with the first `maxBuffer` bytes
   * and `truncated: true` instead of rejecting. The child is killed either way.
   */
  truncateStdout?: boolean
  /** Data written to git's stdin (stdin is closed immediately otherwise). */
  input?: string | Buffer
}

export interface GitResult {
  stdout: Buffer
  stderr: string
  exitCode: number
  /** True when stdout was cut at `maxBuffer` (only possible with `truncateStdout`). */
  truncated: boolean
}

/** A git invocation that failed: non-zero exit, timeout, abort, or git missing. */
export class GitError extends Error {
  override readonly name = 'GitError'

  constructor(
    /** The argv git was started with (never includes secrets: credentials come from helpers). */
    readonly args: readonly string[],
    /** Exit code, or null when git did not exit normally (killed, aborted, not found). */
    readonly exitCode: number | null,
    readonly stderr: string,
    message: string,
  ) {
    super(message)
  }
}

/** Run `git -C <repoPath> <args>` and resolve with its output. Rejects with a GitError. */
export function runGit(
  repoPath: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult> {
  if (repoPath.startsWith('-')) throw badRequest('repository path must not start with "-"')
  return spawnGit(['-C', repoPath, ...args], opts)
}

/**
 * Run `git <args>` without a repository (used for `git clone`). Everything else
 * operates on an existing repository and must use {@link runGit}.
 */
export function runGitGlobal(
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult> {
  return spawnGit(args, opts)
}

interface ChildError extends Error {
  code?: number | string | null
  killed?: boolean
  signal?: NodeJS.Signals | null
}

function spawnGit(argv: readonly string[], opts: RunGitOptions): Promise<GitResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...argv],
      {
        encoding: 'buffer',
        maxBuffer,
        timeout: opts.timeoutMs ?? 0,
        signal: opts.signal,
        windowsHide: true,
        env: {
          ...process.env,
          ...opts.env,
          // Never block on a username/password prompt; fail instead.
          GIT_TERMINAL_PROMPT: '0',
          // Untranslated, byte-stable messages and output.
          LC_ALL: 'C',
          // Read-only commands must not take the index lock in the user's checkout.
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
      (error, stdout, stderr) => {
        const stderrText = redact(stderr.toString('utf8'))
        if (!error) {
          resolve({ stdout, stderr: stderrText, exitCode: 0, truncated: false })
          return
        }
        const err = error as ChildError
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && opts.truncateStdout) {
          resolve({ stdout, stderr: stderrText, exitCode: 0, truncated: true })
          return
        }
        if (typeof err.code === 'number' && opts.okExitCodes?.includes(err.code)) {
          resolve({ stdout, stderr: stderrText, exitCode: err.code, truncated: false })
          return
        }
        reject(toGitError(argv, err, stderrText))
      },
    )
    // git may exit before reading stdin (EPIPE); that is not an error for us.
    child.stdin?.on('error', () => {})
    if (opts.input === undefined) child.stdin?.end()
    else child.stdin?.end(opts.input)
  })
}

function toGitError(argv: readonly string[], err: ChildError, stderr: string): GitError {
  const cmd = `git ${subcommand(argv)}`
  const detail = stderr.trim().split('\n').filter(Boolean).pop()
  const suffix = detail ? `: ${detail}` : ''
  if (err.code === 'ENOENT') {
    return new GitError(argv, null, stderr, 'git is not installed or not on PATH')
  }
  if (err.code === 'ABORT_ERR' || err.name === 'AbortError') {
    return new GitError(argv, null, stderr, `${cmd} was aborted`)
  }
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GitError(argv, null, stderr, `${cmd} produced more output than allowed`)
  }
  if (err.killed || (err.signal && typeof err.code !== 'number')) {
    return new GitError(argv, null, stderr, `${cmd} timed out (${err.signal ?? 'killed'})${suffix}`)
  }
  const exitCode = typeof err.code === 'number' ? err.code : null
  return new GitError(argv, exitCode, stderr, `${cmd} failed (exit ${exitCode ?? '?'})${suffix}`)
}

/** The git subcommand in an argv, skipping global options such as `-C <path>` and `-c k=v`. */
function subcommand(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-C' || arg === '-c') {
      i++
      continue
    }
    if (arg === undefined || arg.startsWith('-')) continue
    return arg
  }
  return ''
}

/** Strip `user:password@` from URLs and cap the length; stderr ends up in API responses. */
function redact(text: string): string {
  const clean = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
  return clean.length > MAX_STDERR_CHARS ? `${clean.slice(0, MAX_STDERR_CHARS)}…` : clean
}

/**
 * Validate a repository-relative path before it is handed to git as a pathspec
 * or as the `<path>` in `<rev>:<path>`. Returns the path unchanged.
 *
 * Rejects (HTTP 400): empty, control characters, a leading `-` (would be an
 * option), a leading `:` (pathspec magic), absolute paths, and `.`/`..`
 * segments. A single trailing slash is allowed (directory pathspecs).
 */
export function assertPathspec(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) throw badRequest('path is required')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\0-\x1f\x7f]/.test(p)) throw badRequest('path contains control characters')
  if (p.startsWith('-')) throw badRequest(`path must not start with "-": ${p}`)
  if (p.startsWith(':')) throw badRequest(`path must not start with ":": ${p}`)
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p)) {
    throw badRequest(`path must be relative to the repository root: ${p}`)
  }
  const segments = p.split('/')
  segments.forEach((segment, i) => {
    if (segment === '..') throw badRequest(`path must not contain "..": ${p}`)
    if (segment === '.') throw badRequest(`path must not contain "." segments: ${p}`)
    if (segment === '' && i !== segments.length - 1) {
      throw badRequest(`path must not contain empty segments: ${p}`)
    }
  })
  return p
}

/**
 * Validate a revision argument (an oid, a ref name, or a range such as `a..b`)
 * so it can never be parsed as an option. Returns it unchanged.
 */
export function assertRevision(rev: unknown): string {
  if (typeof rev !== 'string' || rev.length === 0) throw badRequest('revision is required')
  if (/[\0-\x20\x7f]/.test(rev))
    throw badRequest('revision contains whitespace or control characters')
  if (rev.startsWith('-')) throw badRequest(`revision must not start with "-": ${rev}`)
  return rev
}
