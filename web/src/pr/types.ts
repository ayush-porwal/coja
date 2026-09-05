import type { DiffSide } from '@coja/shared/api'

/** 'unified' is the "stacked" layout in the top-bar toggle; 'split' is side-by-side. */
export type DiffStyle = 'unified' | 'split'

/** What the center pane shows. */
export type CenterSelection = { kind: 'overview' } | { kind: 'file'; path: string }

/**
 * A request to scroll the diff. `nonce` makes repeated requests for the same
 * target distinguishable; `line` is optional (file-only jumps from the tree).
 */
export interface ScrollRequest {
  path: string
  line?: number
  side?: DiffSide
  nonce: number
}

export function isDiffStyle(value: unknown): value is DiffStyle {
  return value === 'unified' || value === 'split'
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * A persisted panel width. Loose on purpose: each handle clamps to its own
 * panel's min/max on load, this only rejects nonsense (and any stale value
 * from a layout we no longer have).
 */
export function isPanelWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 160 && value <= 800
}

/** A persisted split-diff left-column percentage (SplitDivider clamps on load). */
export function isSplitPct(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 5 && value <= 95
}

/** A persisted set of collapsed file paths (stored as a JSON array). */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}
