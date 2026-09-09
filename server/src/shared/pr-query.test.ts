import { describe, expect, it } from 'vitest'
import { formatPrQuery, parsePrQuery, tokenizePrQuery } from './api.js'

describe('PR query syntax', () => {
  it('parses PR states separately from draft status and round trips them', () => {
    for (const state of ['open', 'closed', 'merged', 'all'] as const) {
      const filter = { state, author: 'alice', draft: false }
      expect(parsePrQuery(`is:${state} author:alice is:ready`)).toEqual(filter)
      expect(parsePrQuery(formatPrQuery(filter))).toEqual(filter)
    }
    expect(parsePrQuery('is:open STATE:CLOSED is:draft')).toEqual({ state: 'closed', draft: true })
  })
  it('keeps quoted qualifier values intact', () => {
    expect(parsePrQuery('author:"first last" base:main fix login')).toEqual({
      author: 'first last',
      base: 'main',
      text: 'fix login',
    })
  })
  it('does not interpret open as ready for review', () => {
    expect(parsePrQuery('is:pr is:open')).toEqual({ state: 'open' })
    expect(parsePrQuery('is:draft is:open')).toEqual({ draft: true, state: 'open' })
  })
  it('recognizes aliases case insensitively and uses the last state', () => {
    expect(parsePrQuery('DRAFT:TRUE is:READY')).toEqual({ draft: false })
  })
  it('leaves incomplete and unknown qualifiers as text without highlighting', () => {
    const query = 'author: draft:maybe author:"unfinished value'
    expect(parsePrQuery(query)).toEqual({ text: query })
    expect(tokenizePrQuery(query).every((token) => !token.field)).toBe(true)
  })
  it('preserves literal quoted title text and qualifier round trips', () => {
    expect(parsePrQuery('"author:alice"')).toEqual({ text: '"author:alice"' })
    const filter = { author: 'first last', head: 'feature/"quoted"', draft: false }
    expect(parsePrQuery(formatPrQuery(filter))).toEqual(filter)
  })
})
