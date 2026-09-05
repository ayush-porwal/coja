/**
 * Pure mappings between the wire contract (`@coja/shared/api`) and the
 * `@pierre/diffs` / `@pierre/trees` coordinate systems.
 *
 * - GitHub sides are `LEFT` (base/old file) and `RIGHT` (head/new file).
 * - @pierre uses `'deletions'` (old-file line numbers) and `'additions'`
 *   (new-file line numbers). Both libraries use 1-based file-side line numbers,
 *   so a GitHub `{ side, line }` maps 1:1 to an annotation.
 */
import type { AddCommentRequest, DiffSide, FileChangeType, ReviewThread } from '@coja/shared/api'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  SelectedLineRange,
  SelectionSide,
} from '@pierre/diffs'
import type { GitStatus } from '@pierre/trees'

/** Payload carried by every diff annotation we render. */
export type AnnotationMeta = { kind: 'thread'; threadId: string } | { kind: 'composer' }

const FILE_ITEM_PREFIX = 'file:'

/** CodeView item id for a changed file. */
export const fileItemId = (path: string): string => `${FILE_ITEM_PREFIX}${path}`

/** Inverse of `fileItemId`. */
export function pathFromItemId(id: string): string {
  return id.startsWith(FILE_ITEM_PREFIX) ? id.slice(FILE_ITEM_PREFIX.length) : id
}

export function toDiffSide(side: SelectionSide | AnnotationSide | undefined): DiffSide {
  return side === 'deletions' ? 'LEFT' : 'RIGHT'
}

export function toAnnotationSide(side: DiffSide | null | undefined): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions'
}

export interface NormalizedRange {
  start: number
  end: number
  startSide: SelectionSide
  endSide: SelectionSide
}

/** Fills in @pierre's defaults (`side` → additions, `endSide` → side) and orders start ≤ end. */
export function normalizeRange(range: SelectedLineRange): NormalizedRange {
  const side = range.side ?? 'additions'
  const endSide = range.endSide ?? side
  if (range.start > range.end) {
    return { start: range.end, end: range.start, startSide: endSide, endSide: side }
  }
  return { start: range.start, end: range.end, startSide: side, endSide }
}

/** Selection → `POST prComments` body. Single-line selections omit `startLine`/`startSide`. */
export function rangeToRequest(
  path: string,
  range: SelectedLineRange,
  body: string,
): AddCommentRequest {
  const n = normalizeRange(range)
  const single = n.start === n.end && n.startSide === n.endSide
  const request: AddCommentRequest = { path, body, line: n.end, side: toDiffSide(n.endSide) }
  if (!single) {
    request.startLine = n.start
    request.startSide = toDiffSide(n.startSide)
  }
  return request
}

/**
 * A GitHub review thread → a diff annotation. Outdated threads have no current
 * line (`line === null`); they become file-level annotations (`lineNumber: 0`).
 */
export function threadToAnnotation(thread: ReviewThread): DiffLineAnnotation<AnnotationMeta> {
  return {
    side: toAnnotationSide(thread.side),
    lineNumber: thread.line ?? 0,
    metadata: { kind: 'thread', threadId: thread.id },
  }
}

/** GitHub change type → `@pierre/trees` git-status lane. */
export function changeTypeToGitStatus(changeType: FileChangeType): GitStatus {
  switch (changeType) {
    case 'ADDED':
      return 'added'
    case 'DELETED':
      return 'deleted'
    case 'RENAMED':
    case 'COPIED':
      return 'renamed'
    default:
      return 'modified'
  }
}

export function changeTypeLabel(changeType: FileChangeType): string {
  switch (changeType) {
    case 'ADDED':
      return 'Added'
    case 'DELETED':
      return 'Deleted'
    case 'RENAMED':
      return 'Renamed'
    case 'COPIED':
      return 'Copied'
    case 'CHANGED':
      return 'Changed'
    default:
      return 'Modified'
  }
}

/** Human label for a selection, e.g. `src/a.ts L12–L18 (new)`. */
export function describeRange(path: string, range: NormalizedRange): string {
  const lines = range.start === range.end ? `L${range.end}` : `L${range.start}–L${range.end}`
  const side = range.endSide === 'deletions' ? 'old' : 'new'
  return `${path} ${lines} (${side})`
}
