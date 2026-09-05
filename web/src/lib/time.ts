const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * Compact relative time for list rows: "just now", "5m ago", "3h ago", "2d ago",
 * then a short date ("Mar 3", or "Mar 3, 2025" when the year differs from `now`).
 *
 * Timestamps in the future (clock skew between GitHub and this machine) read as
 * "just now"; an unparseable string is returned unchanged so one bad value never
 * breaks a row.
 */
export function formatRelativeTime(iso: string, now: Date | number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const elapsed = nowMs - then

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`
  return formatShortDate(new Date(then), new Date(nowMs))
}

/** "Mar 3" in the current year, "Mar 3, 2025" otherwise. Uses the local timezone. */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const base = `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}`
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`
}
