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
