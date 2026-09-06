import { describe, expect, it } from 'vitest'
import { formatPrQuery, parsePrQuery, tokenizePrQuery } from './api.js'

describe('PR query syntax', () => {
  it('keeps quoted qualifier values intact', () => {
    expect(parsePrQuery('author:"first last" base:main fix login')).toEqual({
      author: 'first last',
      base: 'main',
      text: 'fix login',
    })
  })
  it('does not interpret open as ready for review', () => {
    expect(parsePrQuery('is:pr is:open')).toEqual({})
    expect(parsePrQuery('is:draft is:open')).toEqual({ draft: true })
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
