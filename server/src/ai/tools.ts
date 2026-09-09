import {
  createReviewTools as createTools,
  type ToolContext as HarnessToolContext,
  type RepositoryReader,
  type ReviewToolOptions,
} from '@coja/agent'
import { blame, blobInfo, countLines, diff, grep, log, lsTree, showFile } from '../git/plumbing.js'

export * from '@coja/agent/tools'

/** The host exposes only read operations to the harness. */
export const reviewRepository: RepositoryReader = {
  blame,
  blobInfo,
  countLines,
  diff,
  grep,
  log,
  lsTree,
  showFile,
}
export type ToolContext = Omit<HarnessToolContext, 'git'>
export function createReviewTools(ctx: ToolContext, opts?: ReviewToolOptions) {
  return createTools({ ...ctx, git: reviewRepository }, opts)
}
