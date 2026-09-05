import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { badRequest } from '../routes/http.js'

/**
 * The only module that spawns git.
 *
 * Every invocation is `execFile('git', argv)` (or `spawn` when stdout is
 * streamed) — an argv array, never a shell — with prompts disabled and stable,
 * untranslated output. Callers hand over arguments as data; pathspecs are
 * validated with {@link assertPathspec} and always placed after a `--`,
 * revisions with {@link assertRevision}, so no user-controlled string can ever
 * be read as an option.
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

export type StreamGitOptions = Pick<RunGitOptions, 'timeoutMs' | 'signal' | 'env'>

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

/**
 * Run `git -C <repoPath> <args>` and resolve with its output. Rejects with a
 * GitError, or with a 400 HttpError when `repoPath` could be read as an option.
 */
export async function runGit(
  repoPath: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult> {
  return spawnGit(['-C', assertRepoPath(repoPath), ...args], opts)
}

/**
 * Run `git <args>` without a repository (used for `git clone` and `git --version`). Everything
 * else operates on an existing repository and must use {@link runGit}.
 */
export async function runGitGlobal(
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult> {
  return spawnGit(args, opts)
}

/**
 * Run `git -C <repoPath> <args>` and hand stdout to `sink` chunk by chunk
 * instead of buffering it, for output that may not fit in memory (counting the
 * lines of a huge blob). Resolves once git exited successfully; rejects with a
 * GitError exactly like {@link runGit}.
 */
export async function runGitStreaming(
  repoPath: string,
  args: readonly string[],
  sink: (chunk: Buffer) => void,
  opts: StreamGitOptions = {},
): Promise<void> {
  const argv = ['-C', assertRepoPath(repoPath), ...args]
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', argv, {
      env: gitEnv(opts.env),
      windowsHide: true,
      signal: opts.signal,
      timeout: opts.timeoutMs ?? 0,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let failure: ChildFailure | undefined
    let settled = false
    const fail = (err: GitError) => {
      if (settled) return
      settled = true
      reject(err)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        sink(chunk)
      } catch (err) {
        child.kill()
        fail(
          new GitError(
            argv,
            null,
            redact(stderr),
            err instanceof Error ? err.message : String(err),
          ),
        )
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString('utf8')
    })
    child.on('error', (err: Error) => {
      failure = err as ChildFailure
      // A spawn failure (git missing) never reaches 'close'; an abort does, once git has exited.
      if (child.pid === undefined) fail(toGitError(argv, failure, redact(stderr)))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      if (failure) return fail(toGitError(argv, failure, redact(stderr)))
      if (code === 0) {
        settled = true
        resolve()
        return
      }
      fail(toGitError(argv, { code, killed: child.killed, signal }, redact(stderr)))
    })
  })
}

/** What Node reports about a child that did not exit cleanly. */
interface ChildFailure {
  name?: string
  code?: number | string | null
  killed?: boolean
  signal?: NodeJS.Signals | null
}

function spawnGit(argv: readonly string[], opts: RunGitOptions): Promise<GitResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
  return new Promise((resolve, reject) => {
    const child: ChildProcess = execFile(
      'git',
      [...argv],
      {
        encoding: 'buffer',
        maxBuffer,
        timeout: opts.timeoutMs ?? 0,
        signal: opts.signal,
        windowsHide: true,
        env: gitEnv(opts.env),
      },
      (error, stdout, stderr) => {
        const settle = () => {
          const stderrText = redact(stderr.toString('utf8'))
          if (!error) {
            resolve({ stdout, stderr: stderrText, exitCode: 0, truncated: false })
            return
          }
          const err = error as ChildFailure
          if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && opts.truncateStdout) {
            resolve({ stdout, stderr: stderrText, exitCode: 0, truncated: true })
            return
          }
          if (typeof err.code === 'number' && opts.okExitCodes?.includes(err.code)) {
            resolve({ stdout, stderr: stderrText, exitCode: err.code, truncated: false })
            return
          }
          reject(toGitError(argv, err, stderrText))
        }
        // On abort, execFile reports before git has actually exited. Wait for it, so a caller
        // that removes a half-written clone afterwards is not racing a still-running git.
        if (
          error &&
          isAbort(error as ChildFailure) &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          child.once('close', settle)
        } else {
          settle()
        }
      },
    )
    // git may exit before reading stdin (EPIPE); that is not an error for us.
    child.stdin?.on('error', () => {})
    if (opts.input === undefined) child.stdin?.end()
    else child.stdin?.end(opts.input)
  })
}

/** The environment every git child gets: the caller's, plus the fixed settings we rely on. */
function gitEnv(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    // Never block on a username/password prompt; fail instead.
    GIT_TERMINAL_PROMPT: '0',
    // Untranslated, byte-stable messages and output.
    LC_ALL: 'C',
    // Read-only commands must not take the index lock in the user's checkout.
    GIT_OPTIONAL_LOCKS: '0',
  }
}

const isAbort = (err: ChildFailure): boolean =>
  err.code === 'ABORT_ERR' || err.name === 'AbortError'

function toGitError(argv: readonly string[], err: ChildFailure, stderr: string): GitError {
  const cmd = `git ${subcommand(argv)}`
  const detail = stderr.trim().split('\n').filter(Boolean).pop()
  const suffix = detail ? `: ${detail}` : ''
  if (err.code === 'ENOENT') {
    return new GitError(argv, null, stderr, 'git is not installed or not on PATH')
  }
  if (isAbort(err)) {
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

function assertRepoPath(repoPath: string): string {
  if (repoPath.startsWith('-')) throw badRequest('repository path must not start with "-"')
  return repoPath
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
