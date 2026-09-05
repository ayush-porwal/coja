import { describe, expect, it } from 'vitest'
import { formatRelativeTime, formatShortDate } from './time'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const s = 1_000
const m = 60 * s
const h = 60 * m
const d = 24 * h

describe('formatRelativeTime', () => {
  it.each([
    ['now', ago(0), 'just now'],
    ['under a minute', ago(59 * s), 'just now'],
    ['in the future (clock skew)', ago(-5 * m), 'just now'],
    ['exactly one minute', ago(1 * m), '1m ago'],
    ['five minutes', ago(5 * m + 20 * s), '5m ago'],
    ['just under an hour', ago(59 * m + 59 * s), '59m ago'],
    ['one hour', ago(1 * h), '1h ago'],
    ['three hours', ago(3 * h + 30 * m), '3h ago'],
    ['just under a day', ago(23 * h + 59 * m), '23h ago'],
    ['one day', ago(1 * d), '1d ago'],
    ['two days', ago(2 * d + 6 * h), '2d ago'],
    ['just under a week', ago(6 * d + 23 * h), '6d ago'],
  ])('%s → %s', (_label, iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected)
  })

  it('falls back to a short date at a week and beyond', () => {
    // Noon UTC keeps the calendar day stable across local timezones (±12h).
    expect(formatRelativeTime('2026-08-29T12:00:00.000Z', NOW)).toBe('Aug 29')
    expect(formatRelativeTime('2026-03-03T12:00:00.000Z', NOW)).toBe('Mar 3')
  })

  it('appends the year when it differs from now', () => {
    expect(formatRelativeTime('2025-12-24T12:00:00.000Z', NOW)).toBe('Dec 24, 2025')
  })

  it('accepts `now` as epoch milliseconds', () => {
    expect(formatRelativeTime(ago(2 * h), NOW.getTime())).toBe('2h ago')
  })

  it('returns unparseable input unchanged', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('not a date')
  })
})

describe('formatShortDate', () => {
  it('omits the year for the current year only', () => {
    expect(formatShortDate(new Date('2026-01-15T12:00:00.000Z'), NOW)).toBe('Jan 15')
    expect(formatShortDate(new Date('2024-01-15T12:00:00.000Z'), NOW)).toBe('Jan 15, 2024')
  })
})
