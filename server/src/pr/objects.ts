import { blobInfo, diff, diffNameStatus, showFile } from '../git/plumbing.js'
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

/**
 * A file's text at `oid`, optionally a 1-based inclusive line range (clamped
 * to the file). 404 when the path does not exist at that commit; 400 for
 * directories and binary files.
 */
export async function getBlob(
  repo: string,
  ref: PrRef,
  oid: string,
  path: string,
  start?: number,
  end?: number,
): Promise<BlobResponse> {
  assertPathspec(path)
  const info = await blobInfo(repo, oid, path)
  if (!info.exists) throw notFound(`${path} at ${ref}`)
  if (info.type !== 'blob') throw badRequest(`${path} is a ${info.type ?? 'non-file'}, not a file`)
  const file = await showFile(repo, oid, path)
  if (file.binary) throw badRequest(`${path} is a binary file`)

  const lines = splitLines(file.text)
  const lineCount = lines.length
  const response: BlobResponse = { ref, oid, path, text: file.text, lineCount }
  if (start === undefined && end === undefined) return response
  if (lineCount === 0) return { ...response, text: '' }
  const startLine = clamp(start ?? 1, 1, lineCount)
  const endLine = clamp(end ?? lineCount, startLine, lineCount)
  return { ...response, startLine, endLine, text: lines.slice(startLine - 1, endLine).join('\n') }
}

/** Lines of `text`; a trailing newline does not start an extra empty line. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)
