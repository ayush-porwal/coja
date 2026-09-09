import type {
  Actor,
  AddCommentRequest,
  AddCommentResponse,
  FileViewedState,
  PrListFilter,
  PullRequestDetail,
  PullRequestPage,
  ReplyResponse,
  RepositoryContributor,
  ReviewComment,
  SubmitReviewRequest,
  SubmitReviewResponse,
} from '../shared/api.js'

/** Identifies a repository on the forge. */
export interface RepoRef {
  owner: string
  repo: string
}

/** The minimum a PR needs for the git layer to fetch it. */
export interface PullRequestRefs {
  /** Forge node id of the PR. */
  id: string
  number: number
  headRefOid: string
  baseRefOid: string
  baseRefName: string
  headRefName: string
}

/**
 * Everything coja needs from a code host. GitHub is the only v1 implementation
 * (see design.md, "GitHub integration"); the interface exists so another
 * provider is additive later.
 *
 * Every method that mutates review state is an explicit human action routed
 * through an HTTP handler. Nothing in the AI layer may hold a reference to a
 * Forge — see the invariant "the AI drafts, the human sends".
 */
export interface Forge {
  listContributors(repo: RepoRef): Promise<RepositoryContributor[]>
  viewer(): Promise<Actor>

  /**
   * One page of open PRs (100 per page; most recently updated first when
   * unfiltered, best-match when a filter is set — GitHub's own behaviour).
   */
  listPullRequestPage(repo: RepoRef, page: number, filter?: PrListFilter): Promise<PullRequestPage>
  /** Cheap lookup of the refs needed to fetch a PR. */
  getPullRequestRefs(repo: RepoRef, number: number): Promise<PullRequestRefs>
  /** Full detail: body, commits, files (with viewed state), threads (incl. the viewer's pending ones), conversation. */
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestDetail>

  /**
   * Add a line/range comment to the viewer's pending review on the PR,
   * creating the pending review (anchored at `headRefOid`) when none exists.
   */
  addPendingComment(
    repo: RepoRef,
    pr: PullRequestRefs,
    input: AddCommentRequest,
  ): Promise<AddCommentResponse>
  /**
   * Reply to an existing review thread. Published immediately when the viewer
   * has no pending review; otherwise GitHub attaches it to the pending review
   * (reported through `comment.isPending`).
   */
  replyToThread(threadId: string, body: string): Promise<ReplyResponse>
  updateComment(commentId: string, body: string): Promise<ReviewComment>
  deleteComment(commentId: string): Promise<void>
  /**
   * Reject with a 404 unless `commentId` is a review comment on pull request
   * `number` of `repo`. Route handlers call this before acting on a
   * client-supplied comment id, so a request scoped to one PR can never touch
   * another PR's comments.
   */
  assertCommentInPullRequest(commentId: string, repo: RepoRef, number: number): Promise<void>
  /** The same check for a review thread id. */
  assertThreadInPullRequest(threadId: string, repo: RepoRef, number: number): Promise<void>

  setFileViewed(prId: string, path: string, viewed: boolean): Promise<FileViewedState>

  /**
   * Submit the viewer's pending review with `event`, or create-and-submit a
   * review when no pending review exists.
   */
  submitReview(
    repo: RepoRef,
    pr: PullRequestRefs,
    input: SubmitReviewRequest,
  ): Promise<SubmitReviewResponse>
  /** Delete the viewer's pending review and all its draft comments. No-op when none exists. */
  discardPendingReview(repo: RepoRef, number: number): Promise<void>
}

/** Raised by Forge implementations when the host rejects a call. */
export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ForgeError'
  }
}
