import { describe, expect, it } from 'vitest'
import {
  changeTypeToGitStatus,
  describeRange,
  fileItemId,
  normalizeRange,
  pathFromItemId,
  rangeToRequest,
  threadToAnnotation,
} from './mapping'
import { makeThread } from './testFixtures'

describe('threadToAnnotation', () => {
  it('maps a RIGHT-side thread to the additions side at its current line', () => {
    expect(threadToAnnotation(makeThread({ side: 'RIGHT', line: 42 }))).toEqual({
      side: 'additions',
      lineNumber: 42,
      metadata: { kind: 'thread', threadId: 'T1' },
    })
  })

  it('maps a LEFT-side thread to the deletions side', () => {
    expect(threadToAnnotation(makeThread({ id: 'T2', side: 'LEFT', line: 7 }))).toEqual({
      side: 'deletions',
      lineNumber: 7,
      metadata: { kind: 'thread', threadId: 'T2' },
    })
  })

  it('places outdated threads without a current line at the file level (line 0)', () => {
    const annotation = threadToAnnotation(
      makeThread({ line: null, isOutdated: true, originalLine: 30 }),
    )
    expect(annotation.lineNumber).toBe(0)
    expect(annotation.side).toBe('additions')
  })
})

describe('normalizeRange', () => {
  it('defaults side to additions and endSide to side', () => {
    expect(normalizeRange({ start: 3, end: 5 })).toEqual({
      start: 3,
      end: 5,
      startSide: 'additions',
      endSide: 'additions',
    })
  })

  it('orders a reversed range and swaps the sides with it', () => {
    expect(normalizeRange({ start: 9, end: 4, side: 'deletions', endSide: 'additions' })).toEqual({
      start: 4,
      end: 9,
      startSide: 'additions',
      endSide: 'deletions',
    })
  })
})

describe('rangeToRequest', () => {
  it('maps a single additions line to RIGHT without a start line', () => {
    expect(rangeToRequest('src/a.ts', { start: 12, end: 12 }, 'hi')).toEqual({
      path: 'src/a.ts',
      body: 'hi',
      line: 12,
      side: 'RIGHT',
    })
  })

  it('maps a multi-line range to line/startLine with sides', () => {
    expect(rangeToRequest('src/a.ts', { start: 10, end: 14, side: 'additions' }, 'hi')).toEqual({
      path: 'src/a.ts',
      body: 'hi',
      line: 14,
      side: 'RIGHT',
      startLine: 10,
      startSide: 'RIGHT',
    })
  })

  it('maps deletions to LEFT', () => {
    expect(rangeToRequest('src/a.ts', { start: 3, end: 3, side: 'deletions' }, 'x')).toEqual({
      path: 'src/a.ts',
      body: 'x',
      line: 3,
      side: 'LEFT',
    })
  })

  it('normalizes start > end (drag upwards)', () => {
    expect(rangeToRequest('src/a.ts', { start: 20, end: 15 }, 'x')).toMatchObject({
      line: 20,
      startLine: 15,
      side: 'RIGHT',
      startSide: 'RIGHT',
    })
  })

  it('keeps distinct sides for a range spanning both columns', () => {
    expect(
      rangeToRequest(
        'src/a.ts',
        { start: 5, end: 8, side: 'deletions', endSide: 'additions' },
        'x',
      ),
    ).toMatchObject({ line: 8, side: 'RIGHT', startLine: 5, startSide: 'LEFT' })
  })

  it('treats the same line on two sides as a range', () => {
    expect(
      rangeToRequest(
        'src/a.ts',
        { start: 5, end: 5, side: 'deletions', endSide: 'additions' },
        'x',
      ),
    ).toMatchObject({ line: 5, side: 'RIGHT', startLine: 5, startSide: 'LEFT' })
  })
})

describe('changeTypeToGitStatus', () => {
  it('maps every GitHub change type onto a tree git status', () => {
    expect(changeTypeToGitStatus('ADDED')).toBe('added')
    expect(changeTypeToGitStatus('DELETED')).toBe('deleted')
    expect(changeTypeToGitStatus('RENAMED')).toBe('renamed')
    expect(changeTypeToGitStatus('COPIED')).toBe('renamed')
    expect(changeTypeToGitStatus('MODIFIED')).toBe('modified')
    expect(changeTypeToGitStatus('CHANGED')).toBe('modified')
  })
})

describe('item ids and labels', () => {
  it('round-trips a path through the CodeView item id', () => {
    expect(fileItemId('src/a b.ts')).toBe('file:src/a b.ts')
    expect(pathFromItemId(fileItemId('src/a.ts'))).toBe('src/a.ts')
  })

  it('describes single lines and ranges with their side', () => {
    expect(describeRange('src/a.ts', normalizeRange({ start: 4, end: 4 }))).toBe(
      'src/a.ts L4 (new)',
    )
    expect(describeRange('src/a.ts', normalizeRange({ start: 4, end: 9, side: 'deletions' }))).toBe(
      'src/a.ts L4–L9 (old)',
    )
  })
})
