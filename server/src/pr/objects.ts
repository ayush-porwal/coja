import { blobInfo, countLines, diff, diffNameStatus, showFile } from '../git/plumbing.js'
import { assertPathspec } from '../git/run.js'
import { badRequest, notFound } from '../routes/http.js'
import type { BlobResponse, FileDiffResponse, GitChangedFile, PrRef } from '../shared/api.js'

/**
 * Read-side views of a fetched pull request, all computed from git objects.
 * `mergeBase` is the diff base (decisions.md), matching GitHub's own PR diff.
 */

export function getChangedFiles(
  repo: string,
  mergeBase: string,
  head: string,
): Promise<GitChangedFile[]> {
  return diffNameStatus(repo, mergeBase, head)
}

/**
 * The unified patch for one file. Pass `previousPath` for renames so git sees
 * both sides and can pair them; without it a rename shows as delete + add.
 */
export async function getFileDiff(
  repo: string,
  mergeBase: string,
  head: string,
  path: string,
  previousPath?: string,
): Promise<FileDiffResponse> {
  assertPathspec(path)
  const paths = [path]
  if (previousPath !== undefined && previousPath !== path) paths.push(assertPathspec(previousPath))
  const { patch, truncated } = await diff(repo, mergeBase, head, { paths })
  const binary = !truncated && isBinaryPatch(patch)
  return {
    path,
    ...(previousPath !== undefined ? { previousPath } : {}),
    patch: binary || truncated ? '' : patch,
    binary,
    tooLarge: truncated,
  }
}

const isBinaryPatch = (patch: string): boolean =>
  /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)

export interface BlobOptions {
  /**
   * Cap on the bytes read into `text` (default: `showFile`'s 5 MiB). Beyond it the response
   * says so through `truncated`; `size` and `lineCount` still describe the whole blob.
   */
  maxBytes?: number
}

/**
 * A file's text at `oid`, optionally a 1-based inclusive line range (clamped
 * to the file). 404 when the path does not exist at that commit; 400 for
 * directories and binary files.
 *
 * Only the first `maxBytes` of a blob are read. When that cuts the file short,
 * `text` keeps whole lines only (the cut line is dropped), `lineCount` is
 * counted from the full blob, and `truncated` tells whether the requested text
 * — the whole file or the range — reached past what was read.
 */
export async function getBlob(
  repo: string,
  ref: PrRef,
  oid: string,
  path: string,
  start?: number,
  end?: number,
  opts: BlobOptions = {},
): Promise<BlobResponse> {
  assertPathspec(path)
  const info = await blobInfo(repo, oid, path)
  if (!info.exists) throw notFound(`${path} at ${ref}`)
  if (info.type !== 'blob') throw badRequest(`${path} is a ${info.type ?? 'non-file'}, not a file`)
  const file = await showFile(
    repo,
    oid,
    path,
    opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes },
  )
  if (file.binary) throw badRequest(`${path} is a binary file`)

  const lines = splitLines(file.text)
  if (file.truncated && !file.text.endsWith('\n')) lines.pop() // the cut fell inside this line
  const lineCount = file.truncated ? await countLines(repo, oid, path) : lines.length
  const base = { ref, oid, path, size: file.size, lineCount }

  if (start === undefined && end === undefined) {
    const text = file.truncated ? joinLines(lines) : file.text
    return { ...base, text, truncated: file.truncated }
  }
  if (lineCount === 0) return { ...base, text: '', truncated: false }
  const startLine = clamp(start ?? 1, 1, lineCount)
  const endLine = clamp(end ?? lineCount, startLine, lineCount)
  return {
    ...base,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join('\n'),
    truncated: endLine > lines.length,
  }
}

/** Lines of `text`; a trailing newline does not start an extra empty line. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Inverse of {@link splitLines} for complete lines: each one newline-terminated. */
const joinLines = (lines: string[]): string => (lines.length === 0 ? '' : `${lines.join('\n')}\n`)

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)
