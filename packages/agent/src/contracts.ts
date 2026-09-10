/** Shared, browser-safe review contracts. */
export type GitChangeStatus = 'A' | 'D' | 'M' | 'R' | 'C' | 'T'
export type PrRef = 'base' | 'head'
export type DiffSide = 'LEFT' | 'RIGHT'
export interface GitChangedFile {
  path: string
  previousPath?: string
  status: GitChangeStatus
}
export interface ContextChip {
  id: string
  kind: 'selection'
  path: string
  ref: PrRef
  side: DiffSide
  startLine: number
  endLine: number
  text: string
}
export interface ChatDataParts {
  chip: ContextChip
  [key: string]: unknown
}
export interface ChatMessageMetadata {
  /** `<provider>:<model id>` used for the assistant turn. */
  model?: string
  createdAt?: string
}

/** Only the PR facts required to construct the model context. */
export interface ReviewDetail {
  number: number
  title: string
  isDraft: boolean
  author: { login: string }
  headRefName: string
  baseRefName: string
  commits: readonly unknown[]
  changedFiles: number
  additions: number
  deletions: number
  body: string
  files: readonly { path: string; additions: number; deletions: number }[]
}
