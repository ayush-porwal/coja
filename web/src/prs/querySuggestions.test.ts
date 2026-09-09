import { describe, expect, it } from 'vitest'
import { completeQuery, querySuggestions, replaceQueryState } from './querySuggestions'

describe('query suggestions', () => {
  it('completes state prefixes and aliases case-insensitively', () => {
    expect(querySuggestions('IS:C', 4).map((s) => s.value)).toEqual(['is:closed'])
    expect(querySuggestions('state:m', 7).map((s) => s.value)).toEqual(['state:merged'])
    expect(querySuggestions('is:closed', 9)).toEqual([])
  })
  it('offers known author and branch values without interpreting title words', () => {
    const values = [{ value: 'author:alice', description: 'Author' }]
    expect(querySuggestions('author:al', 9, values)).toEqual(values)
    expect(querySuggestions('fix login', 9, values)).toEqual([])
    expect(
      querySuggestions('author:alice ', 13, values).some((s) => s.value.startsWith('author:')),
    ).toBe(false)
  })
  it('replaces the whole active token in the middle and keeps suffixes and quotes', () => {
    expect(completeQuery('fix is:cl base:main', 9, 'is:closed')).toEqual({
      query: 'fix is:closed base:main',
      caret: 13,
    })
    expect(completeQuery('head:"feature old" base:main', 12, 'head:feature/new')).toEqual({
      query: 'head:feature/new base:main',
      caret: 16,
    })
    expect(completeQuery('fix ', 4, 'author:')).toEqual({ query: 'fix author:', caret: 11 })
  })
  it('state shortcuts remove conflicting states and preserve other filters', () => {
    expect(replaceQueryState('is:closed author:alice state:open "fix login"', 'all')).toBe(
      'is:all author:alice "fix login"',
    )
  })
})
