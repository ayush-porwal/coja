import { tool } from 'ai'
import { z } from 'zod'
import type { GitChangedFile, PrRef } from './contracts.js'
import type { RepositoryReader } from './repository.js'

/**
 * The agent's complete tool surface: six read-only views of a fetched pull
 * request, each a git plumbing call against objects (design.md, "Harness and
 * security model"). There is no shell, no write and no network tool, and
 * `ref` can only name the PR head or the merge base — the model never picks
 * an arbitrary revision, and paths are validated by the plumbing layer before
 * they reach git. Nothing here can reach GitHub: tool output is streamed to
 * the browser and stored in SQLite, never posted.
 */

export interface ToolContext {
  git: RepositoryReader
  /** Directory git runs in (`git -C`): the user's clone or the app-managed bare clone. */
  repo: string
  /** The PR head commit. */
  headOid: string
  /** The merge base — the old version the diff's left side shows (decisions.md). */
  baseOid: string
  /** Changed files between base and head, as the UI lists them. */
  files: GitChangedFile[]
}

export { REVIEW_TOOL_NAMES, type ReviewToolName } from './tool-names.js'

import { REVIEW_TOOL_NAMES, type ReviewToolName } from './tool-names.js'

// Bounded results keep one turn's context predictable.
export const READ_DEFAULT_LINES = 300
export const READ_MAX_LINES = 400
export const LIST_MAX_ENTRIES = 500
export const GREP_MAX_MATCHES = 100
export const GREP_MAX_TEXT_CHARS = 300
export const DIFF_FILE_MAX_CHARS = 60_000
export const DIFF_ALL_MAX_CHARS = 40_000
export const LOG_MAX_COUNT = 50
export const BLAME_MAX_LINES = 200

const MiB = 1024 * 1024

/** Bytes of a blob read_file and git_blame read; lines beyond are still counted, just not shown. */
export const MAX_BLOB_BYTES = 5 * MiB

export interface ReviewToolOptions {
  /** Test seam: a smaller blob cap than MAX_BLOB_BYTES. */
  maxBlobBytes?: number
}

const TOOL_DESCRIPTIONS: Record<ReviewToolName, string> = {
  read_file:
    `Read a file at the PR head ("head") or at the merge base ("base": the old version the diff's left side shows). ` +
    `Returns at most ${READ_MAX_LINES} lines per call (the first ${READ_DEFAULT_LINES} by default), each prefixed with its line number so you can cite path:line. ` +
    'Use startLine/endLine to read further.',
  list_files:
    'List the files (path and size in bytes) in the repository tree at head or base, recursively, optionally only under a directory such as "src/". ' +
    `At most ${LIST_MAX_ENTRIES} entries.`,
  grep:
    'Search file contents at head or base with an extended regular expression (git grep -E), optionally limited to a path or glob such as "src/*.ts". ' +
    `Returns at most ${GREP_MAX_MATCHES} matches (path, line, text). Cheaper than reading whole files.`,
  get_diff:
    'The pull request diff (merge base to head). Without arguments: the changed files with per-file additions and deletions, plus the whole patch when it is small. ' +
    'With a file path: the unified patch for that one file.',
  git_log:
    'The commits this pull request adds (merge base to head) with their messages, newest first, optionally only those touching a path.',
  git_blame:
    'Per-line authorship of a file at head or base: which commit (author, date, summary) last changed each line. ' +
    `At most ${BLAME_MAX_LINES} lines per call; use startLine/endLine.`,
}

/** Names and one-line descriptions for the "what does the AI see?" affordance. */
export function describeTools(): { name: string; description: string }[] {
  return REVIEW_TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name] }))
}

const refSchema = z
  .enum(['base', 'head'])
  .describe('"head": the pull request\'s code. "base": the merge base, i.e. the old version.')

const pathSchema = z
  .string()
  .min(1)
  .describe(
    'Repository-relative path, exactly as in the changed-files list or a list_files result.',
  )

const lineSchema = z.number().int().min(1)

/** Build the six tools bound to one pull request. The returned object has exactly the REVIEW_TOOL_NAMES keys. */
export function createReviewTools(ctx: ToolContext, opts: ReviewToolOptions = {}) {
  const maxBlobBytes = opts.maxBlobBytes ?? MAX_BLOB_BYTES
  const oidOf = (ref: PrRef): string => (ref === 'head' ? ctx.headOid : ctx.baseOid)

  return {
    read_file: tool({
      description: TOOL_DESCRIPTIONS.read_file,
      inputSchema: z.object({
        ref: refSchema,
        path: pathSchema,
        startLine: lineSchema
          .optional()
          .describe('First line to return (1-based, inclusive). Default 1.'),
        endLine: lineSchema
          .optional()
          .describe(
            `Last line to return (inclusive). Default startLine + ${READ_DEFAULT_LINES - 1}; at most ${READ_MAX_LINES} lines are returned per call.`,
          ),
      }),
      execute: async ({ ref, path, startLine, endLine }) => {
        const oid = oidOf(ref)
        const file = await readTextFile(ctx, oid, ref, path, maxBlobBytes)
        const window = resolveWindow(
          startLine,
          endLine,
          file.lineCount,
          READ_DEFAULT_LINES,
          READ_MAX_LINES,
        )
        // Past the byte cap the lines exist (lineCount counts them) but were not read.
        const shownEnd = Math.min(window.end, file.lines.length)
        const notes: string[] = []
        if (file.truncated) notes.push(truncationNote(file))
        if (shownEnd < window.end) {
          notes.push(
            `Lines ${Math.max(window.start, shownEnd + 1)}-${window.end} lie beyond what was read and are not shown; git_blame returns the content of any line range.`,
          )
        } else if (window.end < file.lineCount) {
          notes.push(
            `Showing lines ${window.start}-${window.end} of ${file.lineCount}. Call read_file again with startLine=${window.end + 1} to continue.`,
          )
        }
        return {
          path,
          ref,
          oid,
          startLine: window.start,
          endLine: window.end,
          lineCount: file.lineCount,
          truncated: window.truncated || shownEnd < window.end,
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
          content: numberLines(file.lines.slice(window.start - 1, shownEnd), window.start),
        }
      },
    }),

    list_files: tool({
      description: TOOL_DESCRIPTIONS.list_files,
      inputSchema: z.object({
        ref: refSchema,
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Only list files under this directory, e.g. "src/" or "src/util". Default: the whole tree.',
          ),
      }),
      execute: async ({ ref, path }) => {
        const oid = oidOf(ref)
        const prefix = path?.replace(/\/+$/, '')
        const entries = (
          await ctx.git.lsTree(ctx.repo, oid, {
            recursive: true,
            ...(prefix ? { path: prefix } : {}),
          })
        ).filter((e) => e.type === 'blob')
        const truncated = entries.length > LIST_MAX_ENTRIES
        let note: string | undefined
        if (truncated) {
          note = `${entries.length} files; showing the first ${LIST_MAX_ENTRIES}. Narrow with path, or use grep.`
        } else if (entries.length === 0) {
          note = prefix
            ? `Nothing under ${prefix} at ${ref}. Check the path with list_files on a parent directory.`
            : `The tree at ${ref} is empty.`
        }
        return {
          ref,
          entries: entries
            .slice(0, LIST_MAX_ENTRIES)
            .map((e) => ({ path: e.path, size: e.size ?? 0 })),
          truncated,
          ...(note ? { note } : {}),
        }
      },
    }),

    grep: tool({
      description: TOOL_DESCRIPTIONS.grep,
      inputSchema: z.object({
        ref: refSchema,
        pattern: z
          .string()
          .min(1)
          .describe('Extended regular expression (POSIX ERE, as in git grep -E).'),
        pathspec: z
          .string()
          .min(1)
          .optional()
          .describe('Limit the search to a path or glob, e.g. "src/" or "*.ts".'),
        ignoreCase: z.boolean().optional(),
      }),
      execute: async ({ ref, pattern, pathspec, ignoreCase }) => {
        // Glob pathspecs ("src/*.ts") are meant to work here, so they pass through as given;
        // the plumbing's assertPathspec still blocks pathspec magic (a leading ":"), option-like
        // values (a leading "-"), ".." and absolute paths.
        const { matches, truncated } = await ctx.git.grep(ctx.repo, oidOf(ref), pattern, {
          ...(pathspec !== undefined ? { pathspec } : {}),
          ...(ignoreCase !== undefined ? { ignoreCase } : {}),
          maxMatches: GREP_MAX_MATCHES,
        })
        return {
          matches: matches.map((m) => ({
            path: m.path,
            line: m.line,
            text: clip(m.text, GREP_MAX_TEXT_CHARS),
          })),
          truncated,
          ...(truncated
            ? {
                note: `More than ${GREP_MAX_MATCHES} matches; showing the first ${GREP_MAX_MATCHES}. Narrow the pattern or pathspec.`,
              }
            : {}),
        }
      },
    }),

    get_diff: tool({
      description: TOOL_DESCRIPTIONS.get_diff,
      inputSchema: z.object({
        file: pathSchema
          .optional()
          .describe(
            'A changed file (its new path for renames). Omit for the whole-PR overview with per-file stats.',
          ),
      }),
      execute: async ({ file }) => (file === undefined ? wholeDiff(ctx) : fileDiff(ctx, file)),
    }),

    git_log: tool({
      description: TOOL_DESCRIPTIONS.git_log,
      inputSchema: z.object({
        path: pathSchema.optional().describe('Only commits that touch this path.'),
        maxCount: lineSchema
          .optional()
          .describe(`How many commits at most (default and maximum ${LOG_MAX_COUNT}).`),
      }),
      execute: async ({ path, maxCount }) => {
        const limit = Math.min(maxCount ?? LOG_MAX_COUNT, LOG_MAX_COUNT)
        const entries = await ctx.git.log(ctx.repo, {
          range: `${ctx.baseOid}..${ctx.headOid}`,
          ...(path !== undefined ? { path } : {}),
          // One extra tells us whether the list was cut.
          maxCount: limit + 1,
        })
        const truncated = entries.length > limit
        return {
          range: `base..head (${short(ctx.baseOid)}..${short(ctx.headOid)})`,
          commits: entries.slice(0, limit).map((c) => ({
            oid: c.oid,
            abbreviatedOid: c.abbreviatedOid,
            author: c.authorName,
            authoredAt: c.authoredAt,
            subject: c.subject,
            body: c.body,
          })),
          truncated,
          ...(truncated
            ? { note: `More than ${limit} commits; showing the newest ${limit}.` }
            : {}),
        }
      },
    }),

    git_blame: tool({
      description: TOOL_DESCRIPTIONS.git_blame,
      inputSchema: z.object({
        ref: refSchema,
        path: pathSchema,
        startLine: lineSchema.optional().describe('First line (1-based, inclusive). Default 1.'),
        endLine: lineSchema
          .optional()
          .describe(`Last line (inclusive). At most ${BLAME_MAX_LINES} lines per call.`),
      }),
      execute: async ({ ref, path, startLine, endLine }) => {
        const oid = oidOf(ref)
        const file = await readTextFile(ctx, oid, ref, path, maxBlobBytes)
        const window = resolveWindow(
          startLine,
          endLine,
          file.lineCount,
          BLAME_MAX_LINES,
          BLAME_MAX_LINES,
        )
        // git blame reads the whole blob itself, so lines past the read cap are still attributed.
        const lines =
          file.lineCount === 0
            ? []
            : await ctx.git.blame(ctx.repo, oid, path, {
                startLine: window.start,
                endLine: window.end,
              })
        const commits: Record<
          string,
          { oid: string; author: string; authoredAt: string; summary: string }
        > = {}
        for (const l of lines) {
          commits[l.abbreviatedOid] ??= {
            oid: l.oid,
            author: l.author,
            authoredAt: l.authorTime,
            summary: l.summary,
          }
        }
        const notes: string[] = []
        if (file.truncated) notes.push(truncationNote(file))
        if (window.end < file.lineCount) {
          notes.push(
            `Lines ${window.start}-${window.end} of ${file.lineCount}. Continue with startLine=${window.end + 1}.`,
          )
        }
        return {
          ref,
          path,
          oid,
          startLine: window.start,
          endLine: window.end,
          lineCount: file.lineCount,
          truncated: window.truncated,
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
          /** Keyed by abbreviated commit oid, as referenced by `lines[].commit`. */
          commits,
          lines: lines.map((l) => ({ line: l.line, commit: l.abbreviatedOid, content: l.content })),
        }
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

async function fileDiff(ctx: ToolContext, file: string) {
  const entry =
    ctx.files.find((f) => f.path === file) ?? ctx.files.find((f) => f.previousPath === file)
  if (!entry) {
    throw new Error(
      `${file} is not changed in this pull request. Call get_diff without arguments to list the changed files.`,
    )
  }
  const paths =
    entry.previousPath !== undefined && entry.previousPath !== entry.path
      ? [entry.path, entry.previousPath]
      : [entry.path]
  const { patch, truncated } = await ctx.git.diff(ctx.repo, ctx.baseOid, ctx.headOid, { paths })
  const binary = !truncated && isBinaryPatch(patch)
  let text = patch
  let cut = false
  let note: string | undefined
  if (truncated) {
    text = ''
    cut = true
    note =
      'The patch is larger than 2 MiB and was withheld. Read the file at base and head with read_file instead.'
  } else if (patch.length > DIFF_FILE_MAX_CHARS) {
    text = clipAtLine(patch, DIFF_FILE_MAX_CHARS)
    cut = true
    note = `Patch truncated at ${DIFF_FILE_MAX_CHARS} of ${patch.length} characters. Use read_file with line windows at head and base for the rest.`
  } else if (binary) {
    note = 'Binary file: there is no text patch.'
  }
  return {
    file: entry.path,
    ...(entry.previousPath !== undefined ? { previousPath: entry.previousPath } : {}),
    status: entry.status,
    binary,
    patch: text,
    truncated: cut,
    ...(note ? { note } : {}),
  }
}

async function wholeDiff(ctx: ToolContext) {
  const full = await ctx.git.diff(ctx.repo, ctx.baseOid, ctx.headOid)
  let stats: Map<string, FileStat>
  if (!full.truncated) {
    stats = patchStats(full.patch)
  } else {
    // Too big to hold with context lines; stats still come from a context-free patch.
    const bare = await ctx.git.diff(ctx.repo, ctx.baseOid, ctx.headOid, {
      unified: 0,
      maxBytes: 32 * MiB,
    })
    stats = bare.truncated ? new Map() : patchStats(bare.patch)
  }
  const files = ctx.files.map((f) => {
    const s = stats.get(f.path)
    return {
      ...f,
      ...(s ? { additions: s.additions, deletions: s.deletions } : {}),
      ...(s?.binary ? { binary: true } : {}),
    }
  })
  const includePatch = !full.truncated && full.patch.length <= DIFF_ALL_MAX_CHARS
  return {
    fileCount: files.length,
    files,
    ...(includePatch
      ? { patch: full.patch }
      : {
          note: `The whole patch is ${full.truncated ? 'over 2 MiB' : `${full.patch.length} characters`}, too large to include. Call get_diff with a file path to see one file's patch.`,
        }),
  }
}

interface FileStat {
  additions: number
  deletions: number
  binary: boolean
}

/**
 * Per-file added/removed line counts from a unified patch, keyed by the new
 * path (the old path for deletions). Header lines (`---`/`+++`) are only
 * recognised before a section's first hunk, so removed lines that happen to
 * start with `--` are counted correctly. Sections without headers (binaries,
 * mode changes) fall back to the `diff --git a/P b/P` line. Paths git quotes
 * (non-ASCII, control characters) are left out rather than guessed.
 */
export function patchStats(patch: string): Map<string, FileStat> {
  const stats = new Map<string, FileStat>()
  let current: FileStat | null = null
  let inHunk = false
  let oldPath: string | null = null
  let newPath: string | null = null
  let samePath: string | null = null
  const real = (p: string | null): string | null => (p !== null && p !== '/dev/null' ? p : null)
  const flush = () => {
    if (!current) return
    const key = real(newPath) ?? real(oldPath) ?? samePath
    if (key !== null) stats.set(key, current)
  }
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      current = { additions: 0, deletions: 0, binary: false }
      inHunk = false
      oldPath = null
      newPath = null
      samePath = parseSamePath(line.slice('diff --git '.length))
      continue
    }
    if (!current) continue
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true
      else if (line.startsWith('--- ')) oldPath = stripPrefix(line.slice(4), 'a/')
      else if (line.startsWith('+++ ')) newPath = stripPrefix(line.slice(4), 'b/')
      else if (line.startsWith('rename from ')) oldPath = line.slice('rename from '.length)
      else if (line.startsWith('rename to ')) newPath = line.slice('rename to '.length)
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch')
        current.binary = true
      continue
    }
    if (line.startsWith('@@')) continue
    if (line.startsWith('+')) current.additions++
    else if (line.startsWith('-')) current.deletions++
  }
  flush()
  return stats
}

/** `a/P b/P` → `P` when both sides name the same path (spaces included); null otherwise. */
function parseSamePath(rest: string): string | null {
  if (!rest.startsWith('a/') || rest.startsWith('"')) return null
  const n = (rest.length - 5) / 2
  if (!Number.isInteger(n) || n <= 0) return null
  const a = rest.slice(2, 2 + n)
  return rest.slice(2 + n, 5 + n) === ' b/' && rest.slice(5 + n) === a ? a : null
}

const stripPrefix = (s: string, prefix: string): string =>
  s.startsWith(prefix) ? s.slice(prefix.length) : s

const isBinaryPatch = (patch: string): boolean =>
  /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

interface TextFile {
  /** Complete lines within the first `maxBytes` — the whole file unless `truncated`. */
  lines: string[]
  /** Lines in the whole blob; counted by git when the read was truncated. */
  lineCount: number
  /** Whole blob size in bytes. */
  size: number
  truncated: boolean
  maxBytes: number
}

/**
 * The text of `path` at `oid`, with clear errors for missing paths, directories
 * and binaries. A blob over `maxBytes` is read up to the cap: `lines` then
 * holds the complete lines that fit while `lineCount` is still the true count,
 * so a window past the cap is "not shown" rather than a false "past the end".
 */
async function readTextFile(
  ctx: ToolContext,
  oid: string,
  ref: PrRef,
  path: string,
  maxBytes: number,
): Promise<TextFile> {
  const info = await ctx.git.blobInfo(ctx.repo, oid, path)
  if (!info.exists) {
    throw new Error(
      `${path} does not exist at ${ref} (${short(oid)})${missingHint(ctx, ref, path)}`,
    )
  }
  if (info.type === 'tree') {
    throw new Error(`${path} is a directory at ${ref}; use list_files to see the files in it`)
  }
  if (info.type !== 'blob') throw new Error(`${path} is a ${info.type} at ${ref}, not a file`)
  const file = await ctx.git.showFile(ctx.repo, oid, path, { maxBytes })
  if (file.binary) {
    throw new Error(`binary file: ${path} at ${ref} (${file.size} bytes) has no text to show`)
  }
  const lines = splitLines(file.text)
  if (!file.truncated) {
    return { lines, lineCount: lines.length, size: file.size, truncated: false, maxBytes }
  }
  // The cut lands mid-line unless the last byte read was a newline; a partial line is worse than none.
  if (!file.text.endsWith('\n')) lines.pop()
  const lineCount = await ctx.git.countLines(ctx.repo, oid, path)
  return { lines, lineCount, size: file.size, truncated: true, maxBytes }
}

/** Shared by read_file and git_blame, so the model hears one story about a capped blob. */
function truncationNote(file: TextFile): string {
  return `The file is ${file.size} bytes; only its first ${describeBytes(file.maxBytes)} (${file.lines.length} complete lines of ${file.lineCount}) were read.`
}

const describeBytes = (n: number): string => (n % MiB === 0 ? `${n / MiB} MiB` : `${n} bytes`)

/** Why a path may be missing at one side of the PR, from the changed-files list. */
function missingHint(ctx: ToolContext, ref: PrRef, path: string): string {
  const entry = ctx.files.find((f) => f.path === path || f.previousPath === path)
  if (!entry) return ''
  if (ref === 'head') {
    if (entry.status === 'D') return '; this PR deletes it, read it with ref "base"'
    if (entry.previousPath === path) return `; this PR renames it to ${entry.path}`
  } else {
    if (entry.status === 'A') return '; this PR adds it, read it with ref "head"'
    if (entry.previousPath !== undefined && entry.path === path) {
      return `; at base it is ${entry.previousPath}`
    }
  }
  return ''
}

interface LineWindow {
  start: number
  end: number
  /** True when fewer lines than requested were returned because of the per-call cap. */
  truncated: boolean
}

/** Clamp a requested 1-based inclusive line range to the file and to `maxLines`. */
function resolveWindow(
  startLine: number | undefined,
  endLine: number | undefined,
  lineCount: number,
  defaultLines: number,
  maxLines: number,
): LineWindow {
  const start = startLine ?? 1
  if (endLine !== undefined && endLine < start) {
    throw new Error(`endLine (${endLine}) must not be smaller than startLine (${start})`)
  }
  if (lineCount === 0) return { start: 1, end: 0, truncated: false }
  if (start > lineCount) {
    throw new Error(`startLine ${start} is past the end of the file, which has ${lineCount} lines`)
  }
  const requestedEnd = Math.min(endLine ?? start + defaultLines - 1, lineCount)
  const cappedEnd = Math.min(requestedEnd, start + maxLines - 1)
  return { start, end: cappedEnd, truncated: cappedEnd < requestedEnd }
}

/** Lines of `text`; a trailing newline does not start an extra empty line. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** `  42│ …` — right-aligned line numbers so the model can cite `path:line`. */
function numberLines(lines: string[], start: number): string {
  const width = Math.max(4, String(start + lines.length - 1).length)
  return lines.map((line, i) => `${String(start + i).padStart(width)}│ ${line}`).join('\n')
}

const short = (oid: string): string => oid.slice(0, 7)

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s)

/** Cut `text` to at most `max` characters, at a line boundary when possible. */
function clipAtLine(text: string, max: number): string {
  const head = text.slice(0, max)
  const nl = head.lastIndexOf('\n')
  return nl > max / 2 ? head.slice(0, nl + 1) : head
}
