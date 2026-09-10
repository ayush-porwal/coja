/** Read-only repository adapter supplied by the host. Implementations must validate paths and revisions. */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'
export interface BlobInfo {
  exists: boolean
  type: ObjectType | null
  size: number | null
  oid: string | null
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
export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  oid: string
  /** Blob size in bytes; null for trees and submodule commits. */
  size: number | null
}
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
export interface DiffOptions {
  /** Limit the diff to these paths (pass both sides of a rename so it is detected). */
  paths?: readonly string[]
  /** Lines of context (default 3). */
  unified?: number
  /** Patches larger than this are withheld (default 2 MiB). */
  maxBytes?: number
}
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
export interface RepositoryReader {
  blame(
    repo: string,
    oid: string,
    path: string,
    opts?: { startLine?: number; endLine?: number },
  ): Promise<BlameLine[]>
  blobInfo(repo: string, oid: string, path: string): Promise<BlobInfo>
  countLines(repo: string, oid: string, path: string): Promise<number>
  diff(
    repo: string,
    base: string,
    head: string,
    opts?: DiffOptions,
  ): Promise<{ patch: string; truncated: boolean }>
  grep(
    repo: string,
    oid: string,
    pattern: string,
    opts?: GrepOptions,
  ): Promise<{ matches: GrepMatch[]; truncated: boolean }>
  log(
    repo: string,
    opts?: { range?: string; path?: string; maxCount?: number },
  ): Promise<LogEntry[]>
  lsTree(
    repo: string,
    oid: string,
    opts?: { path?: string; recursive?: boolean },
  ): Promise<TreeEntry[]>
  showFile(
    repo: string,
    oid: string,
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<ShowFileResult>
}
