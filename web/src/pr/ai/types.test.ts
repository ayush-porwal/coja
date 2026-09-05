import { describe, expect, it } from 'vitest'
import { asChatMessages, isContextChip, summarizeToolCall } from './types'

describe('summarizeToolCall', () => {
  it.each([
    [
      'read_file',
      { ref: 'head', path: 'src/auth.ts', startLine: 41, endLine: 58 },
      'read_file(head, src/auth.ts:41-58)',
    ],
    ['read_file', { ref: 'head', path: 'src/auth.ts' }, 'read_file(head, src/auth.ts)'],
    [
      'read_file',
      { ref: 'base', path: 'src/auth.ts', startLine: 7, endLine: 7 },
      'read_file(base, src/auth.ts:7)',
    ],
    ['read_file', { ref: 'head', path: 'a.ts', startLine: 10 }, 'read_file(head, a.ts:10-)'],
    ['read_file', { ref: 'head', path: 'a.ts', endLine: 10 }, 'read_file(head, a.ts:-10)'],
    ['list_files', { ref: 'head' }, 'list_files(head)'],
    ['list_files', { ref: 'base', path: 'src/' }, 'list_files(base, src/)'],
    ['grep', { ref: 'head', pattern: 'TTL' }, 'grep(head, "TTL")'],
    [
      'grep',
      { ref: 'head', pattern: 'a "b"', pathspec: '*.ts', ignoreCase: true },
      'grep(head, "a \\"b\\"", *.ts, ignoreCase)',
    ],
    ['get_diff', { file: 'src/index.ts' }, 'get_diff(src/index.ts)'],
    ['get_diff', {}, 'get_diff()'],
    ['git_log', {}, 'git_log()'],
    ['git_log', { path: 'src/index.ts', maxCount: 20 }, 'git_log(src/index.ts, maxCount=20)'],
    ['git_log', { maxCount: 5 }, 'git_log(maxCount=5)'],
    [
      'git_blame',
      { ref: 'head', path: 'src/auth.ts', startLine: 1, endLine: 30 },
      'git_blame(head, src/auth.ts:1-30)',
    ],
  ])('%s(%j) → %s', (name, input, expected) => {
    expect(summarizeToolCall(name, input)).toBe(expected)
  })

  it('tolerates partial or missing input while arguments stream in', () => {
    expect(summarizeToolCall('read_file', undefined)).toBe('read_file()')
    expect(summarizeToolCall('read_file', { ref: 'head' })).toBe('read_file(head)')
    expect(summarizeToolCall('read_file', { ref: 'head', startLine: 3 })).toBe('read_file(head)')
    expect(summarizeToolCall('grep', { ref: 'head', ignoreCase: true })).toBe(
      'grep(head, ignoreCase)',
    )
  })

  it('renders unknown tools generically as key=value pairs', () => {
    expect(summarizeToolCall('mystery', { a: 'x/y.ts', b: 2, c: 'has space', d: true })).toBe(
      'mystery(a=x/y.ts, b=2, c="has space", d=true)',
    )
    expect(summarizeToolCall('mystery', 'not an object')).toBe('mystery()')
  })
})

describe('isContextChip', () => {
  const chip = {
    id: 'c1',
    kind: 'selection',
    path: 'src/a.ts',
    ref: 'head',
    side: 'RIGHT',
    startLine: 1,
    endLine: 2,
    text: 'x',
  }
  it('accepts a well-formed chip and rejects anything else', () => {
    expect(isContextChip(chip)).toBe(true)
    expect(isContextChip({ ...chip, ref: 'main' })).toBe(false)
    expect(isContextChip({ ...chip, text: 3 })).toBe(false)
    expect(isContextChip(null)).toBe(false)
  })
})

describe('asChatMessages', () => {
  it('keeps only entries shaped like UI messages', () => {
    const good = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
    expect(
      asChatMessages([good, { id: 'x' }, null, 'nope', { id: 'm2', role: 'bot', parts: [] }]),
    ).toEqual([good])
  })
})
