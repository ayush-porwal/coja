/**
 * Small date helpers for the review screen. Kept local to `web/src/pr` so the
 * screen does not depend on files owned by other parts of the UI.
 */

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * "just now", "5m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "2y ago" —
 * or "in 5m" for future timestamps. Returns the input unchanged when it is not
 * a parsable date.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diffSeconds = Math.round((now - t) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 45) return 'just now'

  let unit: string
  if (abs < HOUR) unit = `${Math.round(abs / MINUTE)}m`
  else if (abs < DAY) unit = `${Math.round(abs / HOUR)}h`
  else if (abs < WEEK) unit = `${Math.round(abs / DAY)}d`
  else if (abs < MONTH) unit = `${Math.round(abs / WEEK)}w`
  else if (abs < YEAR) unit = `${Math.round(abs / MONTH)}mo`
  else unit = `${Math.round(abs / YEAR)}y`

  return diffSeconds >= 0 ? `${unit} ago` : `in ${unit}`
}

/** Full local date-time for tooltips; falls back to the raw string. */
export function formatAbsolute(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}
