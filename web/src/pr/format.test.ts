import { describe, expect, it } from 'vitest'
import { formatAbsolute, formatRelative } from './format'

const NOW = Date.parse('2026-09-05T12:00:00Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('formatRelative', () => {
  it('returns "just now" under 45 seconds', () => {
    expect(formatRelative(ago(0), NOW)).toBe('just now')
    expect(formatRelative(ago(44), NOW)).toBe('just now')
  })

  it('buckets into minutes, hours, days, weeks, months and years', () => {
    expect(formatRelative(ago(5 * 60), NOW)).toBe('5m ago')
    expect(formatRelative(ago(3 * 3600), NOW)).toBe('3h ago')
    expect(formatRelative(ago(2 * 86400), NOW)).toBe('2d ago')
    expect(formatRelative(ago(3 * 7 * 86400), NOW)).toBe('3w ago')
    expect(formatRelative(ago(4 * 30 * 86400), NOW)).toBe('4mo ago')
    expect(formatRelative(ago(2 * 365 * 86400), NOW)).toBe('2y ago')
  })

  it('handles future timestamps', () => {
    expect(formatRelative(ago(-10 * 60), NOW)).toBe('in 10m')
  })

  it('returns unparsable input unchanged', () => {
    expect(formatRelative('not a date', NOW)).toBe('not a date')
    expect(formatAbsolute('not a date')).toBe('not a date')
  })
})
