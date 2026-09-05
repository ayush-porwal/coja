import { badRequest } from '../routes/http.js'
import type { GitChangedFile, GitChangeStatus } from '../shared/api.js'
import { assertPathspec, assertRevision, GitError, runGit, runGitGlobal } from './run.js'

/**
 * Typed wrappers over git plumbing. Every function takes `repo`, a directory
 * usable with `git -C` (the user's clone or an app-managed bare clone), and
 * reads objects only: nothing here checks out, writes blobs to disk, or
 * touches the user's branches. The only writes are `fetch` into the
 * `refs/coja/*` namespace and `cloneBare` into the app data directory.
 */

const MiB = 1024 * 1024

/** `gh` supplies the token for https fetches at call time; nothing is written to disk. */
export const GH_CREDENTIAL_HELPER = '!gh auth git-credential'

/** git considers a file binary when its first 8000 bytes contain a NUL. */
const BINARY_PROBE_BYTES = 8000

const DEFAULT_FETCH_TIMEOUT_MS = 15 * 60 * 1000

// ---------------------------------------------------------------------------
// Repository facts
// ---------------------------------------------------------------------------

/** True when `dir` is inside a git repository (working tree or bare). */
export async function isGitRepo(dir: string): Promise<boolean> {
  return (await tryGit(dir, ['rev-parse', '--git-dir'])) !== null
}

export async function isBareRepo(dir: string): Promise<boolean> {
  const out = await tryGit(dir, ['rev-parse', '--is-bare-repository'])
  return out?.trim() === 'true'
}

/** Absolute path of the working tree root; null for a bare repository. */
export async function topLevel(repo: string): Promise<string | null> {
  const out = await tryGit(repo, ['rev-parse', '--show-toplevel'])
  const top = out?.trim()
  return top ? top : null
}

/** The configured URL of `remote` (as written in the config, before any insteadOf rewriting). */
export async function remoteUrl(repo: string, remote = 'origin'): Promise<string | null> {
  const res = await runGit(repo, ['config', '--get', `remote.${remote}.url`], { okExitCodes: [1] })
  if (res.exitCode !== 0) return null
  const url = res.stdout.toString('utf8').trim()
  return url ? url : null
}

/** Resolve `ref` to a commit oid; null when it does not exist or is not a commit. */
export async function revParse(repo: string, ref: string): Promise<string | null> {
  assertRevision(ref)
  const res = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    okExitCodes: [1],
  })
  if (res.exitCode !== 0) return null
  const oid = res.stdout.toString('utf8').trim()
  return oid ? oid : null
}

export async function mergeBase(repo: string, a: string, b: string): Promise<string> {
  assertRevision(a)
  assertRevision(b)
  const args = ['merge-base', a, b]
  const res = await runGit(repo, args, { okExitCodes: [1] })
  if (res.exitCode !== 0) {
    throw new GitError(args, 1, res.stderr, `${a} and ${b} have no common ancestor`)
  }
  return res.stdout.toString('utf8').trim()
}

// ---------------------------------------------------------------------------
// Network: fetch and clone
// ---------------------------------------------------------------------------

export interface FetchOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * `git fetch` the given refspecs from `remote`. Callers pass explicit,
 * namespaced destinations (`+refs/pull/1/head:refs/coja/pull/1/head`), so the
 * user's branches and FETCH_HEAD are never written; tags and pruning are off so
 * the fetch touches nothing beyond those refs.
 */
export async function fetch(
  repo: string,
  remote: string,
  refspecs: readonly string[],
  opts: FetchOptions = {},
): Promise<void> {
  if (refspecs.length === 0) throw new Error('fetch: at least one refspec is required')
  for (const arg of [remote, ...refspecs]) {
    if (arg.startsWith('-') || arg.length === 0) throw new Error(`fetch: invalid argument ${arg}`)
  }
  await runGit(
    repo,
    [
      'fetch',
      '--no-tags',
      '--no-prune',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--quiet',
      '--',
      remote,
      ...refspecs,
    ],
    { signal: opts.signal, timeoutMs: opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS },
  )
}

/**
 * `git clone --bare` `url` into `dir` (which must not exist yet), with `gh` as
 * the repository's credential helper — both for the clone itself and for later
 * fetches of private repositories. No token is ever written to disk.
 */
export async function cloneBare(
  url: string,
  dir: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (url.startsWith('-') || dir.startsWith('-')) throw badRequest('invalid clone arguments')
  await runGitGlobal(
    [
      'clone',
      '--bare',
      '--quiet',
      // Reset inherited helpers so this repository authenticates through gh only.
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=${GH_CREDENTIAL_HELPER}`,
      '--',
      url,
      dir,
    ],
    { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 0 },
  )
  // `clone -c` persists the values above; make sure the helper is really there.
  const helpers = await runGit(dir, ['config', '--get-all', 'credential.helper'], {
    okExitCodes: [1],
  })
  if (!helpers.stdout.toString('utf8').split('\n').includes(GH_CREDENTIAL_HELPER)) {
    await runGit(dir, ['config', '--add', 'credential.helper', GH_CREDENTIAL_HELPER])
  }
}

// ---------------------------------------------------------------------------
// Objects: blobs and trees
// ---------------------------------------------------------------------------

export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'

export interface BlobInfo {
  exists: boolean
  type: ObjectType | null
  size: number | null
  oid: string | null
}

/** Type and size of `<oid>:<path>` via `cat-file --batch-check`; `exists: false` when the path is absent. */
export async function blobInfo(repo: string, oid: string, path: string): Promise<BlobInfo> {
  assertRevision(oid)
  assertPathspec(path)
  const res = await runGit(repo, ['cat-file', '--batch-check'], { input: `${oid}:${path}\n` })
  const line = res.stdout.toString('utf8').split('\n')[0] ?? ''
  const m = /^([0-9a-f]{40,64}) (blob|tree|commit|tag) (\d+)$/.exec(line)
  if (!m) return { exists: false, type: null, size: null, oid: null }
  return { exists: true, type: m[2] as ObjectType, size: Number(m[3]), oid: m[1] ?? null }
}

export interface ShowFileResult {
  /** UTF-8 decoded content; empty for binary files. */
  text: string
  binary: boolean
  /** Size of the whole blob in bytes. */
  size: number
  /** True when `text` holds only the first `maxBytes` bytes. */
  truncated: boolean
}

/** Content of the blob at `<oid>:<path>` (`git cat-file blob`). Fails with GitError when it is not a blob. */
export async function showFile(
  repo: string,
  oid: string,
  path: string,
  opts: { maxBytes?: number } = {},
): Promise<ShowFileResult> {
  assertRevision(oid)
  assertPathspec(path)
  const maxBytes = opts.maxBytes ?? 5 * MiB
  const res = await runGit(repo, ['cat-file', 'blob', `${oid}:${path}`], {
    maxBuffer: maxBytes,
    truncateStdout: true,
  })
  const buf = res.stdout
  const binary = buf.subarray(0, BINARY_PROBE_BYTES).includes(0)
  let size = buf.byteLength
  if (res.truncated) size = (await blobInfo(repo, oid, path)).size ?? size
  return { text: binary ? '' : buf.toString('utf8'), binary, size, truncated: res.truncated }
}

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  oid: string
  /** Blob size in bytes; null for trees and submodule commits. */
  size: number | null
}

/** List a tree (`ls-tree -z -l`), recursively by default, optionally limited to `path`. */
export async function lsTree(
  repo: string,
  oid: string,
  opts: { path?: string; recursive?: boolean } = {},
): Promise<TreeEntry[]> {
  assertRevision(oid)
  const args = ['--literal-pathspecs', 'ls-tree', '-z', '-l', '--full-tree']
  if (opts.recursive ?? true) args.push('-r')
  args.push(oid)
  if (opts.path !== undefined) args.push('--', assertPathspec(opts.path))
  const out = (await runGit(repo, args)).stdout.toString('utf8')
  const entries: TreeEntry[] = []
  for (const record of out.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const [mode, type, entryOid, size] = record.slice(0, tab).split(/\s+/)
    if (!mode || !type || !entryOid) continue
    if (type !== 'blob' && type !== 'tree' && type !== 'commit') continue
    entries.push({
      path: record.slice(tab + 1),
      mode,
      type,
      oid: entryOid,
      size: size === undefined || size === '-' ? null : Number(size),
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface GrepMatch {
  path: string
  /** 1-based line number. */
  line: number
  text: string
}

export interface GrepOptions {
  /** Limit the search to this pathspec (globs allowed, e.g. `src/*.ts`). */
  pathspec?: string
  ignoreCase?: boolean
  /** Treat `pattern` as a literal string instead of an extended regular expression. */
  fixedStrings?: boolean
  maxMatches?: number
}

/** Search the tree at `oid` (`git grep -n -I`). Binary files are skipped; exit code 1 means no matches. */
export async function grep(
  repo: string,
  oid: string,
  pattern: string,
  opts: GrepOptions = {},
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  assertRevision(oid)
  if (typeof pattern !== 'string' || pattern.length === 0) throw badRequest('pattern is required')
  const maxMatches = opts.maxMatches ?? 200
  const args = ['grep', '-n', '-I', '--no-color', '-z', '--full-name']
  if (opts.ignoreCase) args.push('-i')
  args.push(opts.fixedStrings ? '-F' : '-E')
  // The pattern follows `-e`, so a pattern starting with `-` is never an option.
  args.push('-e', pattern, oid, '--')
  if (opts.pathspec !== undefined) args.push(assertPathspec(opts.pathspec))
  const res = await runGit(repo, args, {
    okExitCodes: [1],
    maxBuffer: 16 * MiB,
    truncateStdout: true,
  })
  if (res.exitCode === 1) return { matches: [], truncated: false }

  const prefix = `${oid}:`
  const lines = res.stdout.toString('utf8').split('\n')
  if (res.truncated) lines.pop() // the last line was cut mid-way
  const matches: GrepMatch[] = []
  let truncated = res.truncated
  for (const line of lines) {
    if (!line) continue
    if (matches.length >= maxMatches) {
      truncated = true
      break
    }
    // With -z: `<rev>:<path>\0<line>\0<text>`
    const firstNul = line.indexOf('\0')
    const secondNul = firstNul === -1 ? -1 : line.indexOf('\0', firstNul + 1)
    if (firstNul === -1 || secondNul === -1) continue
    const name = line.slice(0, firstNul)
    matches.push({
      path: name.startsWith(prefix) ? name.slice(prefix.length) : name,
      line: Number(line.slice(firstNul + 1, secondNul)),
      text: line.slice(secondNul + 1),
    })
  }
  return { matches, truncated }
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

export interface DiffOptions {
  /** Limit the diff to these paths (pass both sides of a rename so it is detected). */
  paths?: readonly string[]
  /** Lines of context (default 3). */
  unified?: number
  /** Patches larger than this are withheld (default 2 MiB). */
  maxBytes?: number
}

/**
 * Unified patch between two commits (`git diff <base> <head>`), with standard
 * `a/` `b/` prefixes regardless of the user's diff.* configuration so the UI's
 * parser always sees canonical git output.
 */
export async function diff(
  repo: string,
  base: string,
  head: string,
  opts: DiffOptions = {},
): Promise<{ patch: string; truncated: boolean }> {
  assertRevision(base)
  assertRevision(head)
  const unified = opts.unified ?? 3
  if (!Number.isInteger(unified) || unified < 0)
    throw badRequest('unified must be a non-negative integer')
  const args = [
    '--literal-pathspecs',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--submodule=short',
    `-U${unified}`,
    base,
    head,
  ]
  if (opts.paths && opts.paths.length > 0) args.push('--', ...opts.paths.map(assertPathspec))
  const res = await runGit(repo, args, {
    maxBuffer: opts.maxBytes ?? 2 * MiB,
    truncateStdout: true,
  })
  if (res.truncated) return { patch: '', truncated: true }
  return { patch: res.stdout.toString('utf8'), truncated: false }
}

const CHANGE_STATUSES: ReadonlySet<string> = new Set(['A', 'D', 'M', 'R', 'C', 'T'])

/** Changed files between two commits with rename detection (`diff --name-status --find-renames -z`). */
export async function diffNameStatus(
  repo: string,
  base: string,
  head: string,
): Promise<GitChangedFile[]> {
  assertRevision(base)
  assertRevision(head)
  const res = await runGit(repo, [
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    base,
    head,
  ])
  const tokens = res.stdout.toString('utf8').split('\0')
  const files: GitChangedFile[] = []
  for (let i = 0; i < tokens.length; ) {
    const rawStatus = tokens[i++]
    if (!rawStatus) continue
    const letter = rawStatus[0] ?? ''
    // `R100`/`C075` carry a similarity score and are followed by <old>\0<new>.
    if (letter === 'R' || letter === 'C') {
      const previousPath = tokens[i++]
      const path = tokens[i++]
      if (previousPath === undefined || path === undefined) break
      files.push({ path, previousPath, status: letter })
      continue
    }
    const path = tokens[i++]
    if (path === undefined) break
    files.push({ path, status: CHANGE_STATUSES.has(letter) ? (letter as GitChangeStatus) : 'M' })
  }
  return files
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface LogEntry {
  oid: string
  abbreviatedOid: string
  authorName: string
  authorEmail: string
  /** Strict ISO 8601 author date. */
  authoredAt: string
  subject: string
  body: string
}

const LOG_FIELD = '\x1f'
const LOG_RECORD = '\x1e'
const LOG_FORMAT = `${['%H', '%h', '%an', '%ae', '%aI', '%s', '%b'].join('%x1f')}%x1e`

/** Commit history (`git log`), newest first, optionally for a range such as `base..head` and a path. */
export async function log(
  repo: string,
  opts: { range?: string; path?: string; maxCount?: number } = {},
): Promise<LogEntry[]> {
  const maxCount = opts.maxCount ?? 50
  if (!Number.isInteger(maxCount) || maxCount <= 0)
    throw badRequest('maxCount must be a positive integer')
  const args = [
    '--literal-pathspecs',
    'log',
    '--no-color',
    '--no-show-signature',
    '--date=iso-strict',
    `--format=${LOG_FORMAT}`,
    '-n',
    String(maxCount),
  ]
  if (opts.range !== undefined) args.push(assertRevision(opts.range))
  if (opts.path !== undefined) args.push('--', assertPathspec(opts.path))
  const out = (await runGit(repo, args)).stdout.toString('utf8')
  const entries: LogEntry[] = []
  for (const raw of out.split(LOG_RECORD)) {
    const record = raw.replace(/^\n/, '')
    if (!record) continue
    const fields = splitN(record, LOG_FIELD, 7)
    const [oid, abbreviatedOid, authorName, authorEmail, authoredAt, subject, body] = fields
    if (!oid || abbreviatedOid === undefined) continue
    entries.push({
      oid,
      abbreviatedOid,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authoredAt: authoredAt ?? '',
      subject: subject ?? '',
      body: (body ?? '').trimEnd(),
    })
  }
  return entries
}

/** Split into at most `n` parts; the last part keeps any further separators. */
function splitN(s: string, sep: string, n: number): string[] {
  const parts: string[] = []
  let start = 0
  while (parts.length < n - 1) {
    const idx = s.indexOf(sep, start)
    if (idx === -1) break
    parts.push(s.slice(start, idx))
    start = idx + sep.length
  }
  parts.push(s.slice(start))
  return parts
}

export interface BlameLine {
  /** 1-based line number in the file at `oid`. */
  line: number
  oid: string
  abbreviatedOid: string
  author: string
  /** ISO 8601 author time in the author's timezone. */
  authorTime: string
  summary: string
  content: string
}

/** Per-line authorship (`git blame --porcelain`), optionally limited to an inclusive line range. */
export async function blame(
  repo: string,
  oid: string,
  path: string,
  opts: { startLine?: number; endLine?: number } = {},
): Promise<BlameLine[]> {
  assertRevision(oid)
  assertPathspec(path)
  const args = ['blame', '--porcelain']
  if (opts.startLine !== undefined || opts.endLine !== undefined) {
    const start = opts.startLine ?? 1
    const end = opts.endLine
    if (!Number.isInteger(start) || start < 1)
      throw badRequest('startLine must be a positive integer')
    if (end !== undefined && (!Number.isInteger(end) || end < start)) {
      throw badRequest('endLine must be an integer >= startLine')
    }
    args.push('-L', `${start},${end ?? ''}`)
  }
  args.push(oid, '--', path)
  const out = (await runGit(repo, args)).stdout.toString('utf8')
  return parseBlamePorcelain(out)
}

interface BlameCommitInfo {
  author: string
  authorTime: number
  authorTz: string
  summary: string
}

function parseBlamePorcelain(out: string): BlameLine[] {
  const lines = out.split('\n')
  const commits = new Map<string, BlameCommitInfo>()
  const result: BlameLine[] = []
  let i = 0
  while (i < lines.length) {
    const header = lines[i]
    if (!header) {
      i++
      continue
    }
    const m = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(header)
    if (!m?.[1] || !m[2]) throw new Error(`unexpected git blame output: ${header}`)
    const sha = m[1]
    const finalLine = Number(m[2])
    i++
    const info = commits.get(sha) ?? { author: '', authorTime: 0, authorTz: '+0000', summary: '' }
    // Header key/value lines appear the first time a commit is seen; the content line starts with a tab.
    while (i < lines.length && !(lines[i] ?? '').startsWith('\t')) {
      const kv = lines[i] ?? ''
      const sp = kv.indexOf(' ')
      const key = sp === -1 ? kv : kv.slice(0, sp)
      const value = sp === -1 ? '' : kv.slice(sp + 1)
      if (key === 'author') info.author = value
      else if (key === 'author-time') info.authorTime = Number(value)
      else if (key === 'author-tz') info.authorTz = value
      else if (key === 'summary') info.summary = value
      i++
    }
    commits.set(sha, info)
    const content = (lines[i] ?? '').slice(1)
    i++
    result.push({
      line: finalLine,
      oid: sha,
      abbreviatedOid: sha.slice(0, 7),
      author: info.author,
      authorTime: epochToIso(info.authorTime, info.authorTz),
      summary: info.summary,
      content,
    })
  }
  return result
}

/** `1704164645` + `+0200` → `2024-01-02T05:04:05+02:00`; UTC is written as `Z`, like git's `%aI`. */
function epochToIso(epochSeconds: number, tz: string): string {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz)
  const sign = m?.[1] === '-' ? -1 : 1
  const hh = m?.[2] ?? '00'
  const mm = m?.[3] ?? '00'
  const offsetSeconds = sign * (Number(hh) * 3600 + Number(mm) * 60)
  const shifted = new Date((epochSeconds + offsetSeconds) * 1000)
  const zone = offsetSeconds === 0 ? 'Z' : `${sign < 0 ? '-' : '+'}${hh}:${mm}`
  return `${shifted.toISOString().slice(0, 19)}${zone}`
}

// ---------------------------------------------------------------------------

/** Run a read-only query; null when git exits non-zero (e.g. not a repository). Other failures propagate. */
async function tryGit(dir: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await runGit(dir, args)).stdout.toString('utf8')
  } catch (err) {
    if (err instanceof GitError && err.exitCode !== null) return null
    throw err
  }
}
