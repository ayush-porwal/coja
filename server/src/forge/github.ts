import { HttpError } from '../routes/http.js'
import type {
  Actor,
  AddCommentRequest,
  AddCommentResponse,
  ChangedFile,
  Commit,
  ConversationItem,
  DiffSide,
  FileChangeType,
  FileViewedState,
  MyReviewState,
  PendingReview,
  PullRequestDetail,
  PullRequestSummary,
  ReplyResponse,
  ReviewComment,
  ReviewState,
  ReviewThread,
  SubmitReviewRequest,
  SubmitReviewResponse,
} from '../shared/api.js'
import { type Forge, ForgeError, type PullRequestRefs, type RepoRef } from './forge.js'
import type { GqlFn } from './graphql.js'
import * as q from './queries.js'

/**
 * The GitHub implementation of `Forge`, on top of the GraphQL API. GitHub is
 * the source of truth for all review state (design.md, "Sync model"): nothing
 * here is cached except the viewer's identity.
 *
 * Every mutation in this class is reached only from an HTTP route handler that
 * a human triggered in the UI. Nothing under server/src/ai may import it.
 */

/** Open-PR list pages of 100; a repo with more than this many open PRs is truncated. */
const MAX_PR_LIST_PAGES = 10
/** GitHub caps a PR's commit list at 250 regardless of paging (100 + 100 + 50). */
const MAX_COMMIT_PAGES = 3
/** Runaway guard for the other connections (files are capped by GitHub at 3000 = 30 pages). */
const MAX_PAGES = 50

export const COMMENT_LOCATION_REJECTED =
  'GitHub rejected the comment location: the line must be part of the pull request diff.'
export const SUMMARY_REQUIRED = 'Write a summary or add at least one comment first.'

export interface GitHubForgeOptions {
  gql: GqlFn
}

export class GitHubForge implements Forge {
  private readonly gql: GqlFn
  private viewerPromise: Promise<Actor> | undefined

  constructor(opts: GitHubForgeOptions) {
    this.gql = opts.gql
  }

  viewer(): Promise<Actor> {
    if (!this.viewerPromise) {
      const p = this.gql<q.ViewerData>(q.VIEWER).then((d) => mapActor(d.viewer))
      // Do not cache a failure: the next call retries.
      p.catch(() => {
        if (this.viewerPromise === p) this.viewerPromise = undefined
      })
      this.viewerPromise = p
    }
    return this.viewerPromise
  }

  async listOpenPullRequests(repo: RepoRef): Promise<PullRequestSummary[]> {
    const { login } = await this.viewer()
    const vars = { owner: repo.owner, name: repo.repo, login }
    const first = await this.gql<q.PrListData>(q.PR_LIST, vars)
    const connection = first.repository?.pullRequests
    if (!connection) throw repoNotFound(repo)
    const nodes = await drain(
      connection,
      async (after) => {
        const d = await this.gql<q.PrListData>(q.PR_LIST, { ...vars, after })
        return d.repository?.pullRequests ?? EMPTY
      },
      MAX_PR_LIST_PAGES,
    )
    return nodes.map(mapSummary)
  }

  async getPullRequestRefs(repo: RepoRef, number: number): Promise<PullRequestRefs> {
    const d = await this.gql<q.PrRefsData>(q.PR_REFS, {
      owner: repo.owner,
      name: repo.repo,
      number,
    })
    const pr = d.repository?.pullRequest
    if (!pr) throw prNotFound(repo, number)
    return {
      id: pr.id,
      number: pr.number,
      headRefOid: pr.headRefOid,
      baseRefOid: pr.baseRefOid,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
    }
  }

  async getPullRequest(repo: RepoRef, number: number): Promise<PullRequestDetail> {
    const viewer = await this.viewer()
    const vars = { owner: repo.owner, name: repo.repo, number, login: viewer.login }
    const data = await this.gql<q.PrDetailData>(q.PR_DETAIL, vars)
    const pr = data.repository?.pullRequest
    if (!pr) throw prNotFound(repo, number)

    const page = <D, T>(doc: string, pick: (d: D) => q.Connection<T> | null | undefined) => {
      return async (after: string): Promise<q.Connection<T>> =>
        pick(await this.gql<D>(doc, { ...vars, after })) ?? EMPTY
    }
    const [commits, files, rawThreads, reviews, issueComments] = await Promise.all([
      drain(
        pr.commits,
        page<q.PrCommitsPageData, q.RawCommit>(
          q.PR_COMMITS_PAGE,
          (d) => d.repository?.pullRequest?.commits,
        ),
        MAX_COMMIT_PAGES,
      ),
      drain(
        pr.files,
        page<q.PrFilesPageData, q.RawFile>(
          q.PR_FILES_PAGE,
          (d) => d.repository?.pullRequest?.files,
        ),
      ),
      drain(
        pr.reviewThreads,
        page<q.PrThreadsPageData, q.RawThread>(
          q.PR_THREADS_PAGE,
          (d) => d.repository?.pullRequest?.reviewThreads,
        ),
      ),
      drain(
        pr.reviews,
        page<q.PrReviewsPageData, q.RawReview>(
          q.PR_REVIEWS_PAGE,
          (d) => d.repository?.pullRequest?.reviews,
        ),
      ),
      drain(
        pr.comments,
        page<q.PrIssueCommentsPageData, q.RawIssueComment>(
          q.PR_ISSUE_COMMENTS_PAGE,
          (d) => d.repository?.pullRequest?.comments,
        ),
      ),
    ])

    const threads = await Promise.all(
      rawThreads.map(async (t) => {
        const comments = await drain(t.comments, async (after) => {
          const d = await this.gql<q.ThreadCommentsPageData>(q.THREAD_COMMENTS_PAGE, {
            id: t.id,
            after,
          })
          return d.node?.comments ?? EMPTY
        })
        return mapThread(
          t,
          comments.map((c) => mapComment(c, viewer.login)),
        )
      }),
    )

    return {
      ...mapSummary(pr),
      body: pr.body,
      bodyHTML: pr.bodyHTML,
      commits: commits.map(mapCommit),
      files: files.map(mapFile),
      threads,
      conversation: buildConversation(issueComments, reviews),
      pendingReview: mapPendingReview(pr.pendingReview?.nodes),
      viewer,
    }
  }

  async addPendingComment(
    repo: RepoRef,
    pr: PullRequestRefs,
    input: AddCommentRequest,
  ): Promise<AddCommentResponse> {
    const viewer = await this.viewer()
    let pending = await this.findPendingReview(repo, pr.number, viewer.login)
    if (!pending) {
      const d = await this.gql<q.StartReviewData>(q.START_REVIEW, {
        pullRequestId: pr.id,
        commitOID: pr.headRefOid,
      })
      const review = d.addPullRequestReview?.pullRequestReview
      if (!review) throw new ForgeError('GitHub did not create a pending review.', 502)
      pending = { id: review.id, commentCount: 0 }
    }

    const threadInput: Record<string, unknown> = {
      pullRequestReviewId: pending.id,
      path: input.path,
      body: input.body,
      line: input.line,
      side: input.side,
    }
    if (input.startLine != null && input.startLine !== input.line) {
      threadInput.startLine = input.startLine
      threadInput.startSide = input.startSide ?? input.side
    }
    const d = await this.gql<q.AddThreadData>(q.ADD_THREAD, { input: threadInput })
    const thread = d.addPullRequestReviewThread?.thread
    if (!thread) throw new ForgeError(COMMENT_LOCATION_REJECTED, 422)

    const comments = compact(thread.comments.nodes).map((c) => ({
      ...mapComment(c, viewer.login),
      reviewId: c.pullRequestReview?.id ?? pending.id,
      reviewState: 'PENDING' as const,
      isPending: true,
      isMine: true,
    }))
    const commentCount =
      compact(thread.firstComment?.nodes)[0]?.pullRequestReview?.comments?.totalCount ??
      pending.commentCount + 1
    return {
      thread: mapThread(thread, comments),
      pendingReview: { id: pending.id, commentCount },
    }
  }

  /**
   * Reply without a pending-review id. Published immediately when the viewer has no pending
   * review; when one is open GitHub attaches the reply to it instead (observed live), and the
   * returned comment says so through `isPending` / `reviewId`.
   */
  async replyToThread(threadId: string, body: string): Promise<ReplyResponse> {
    const viewer = await this.viewer()
    const d = await this.gql<q.ReplyData>(q.REPLY, { threadId, body })
    const comment = d.addPullRequestReviewThreadReply?.comment
    if (!comment) throw new ForgeError('GitHub did not return the posted reply.', 502)
    return { comment: mapComment(comment, viewer.login), threadId }
  }

  async updateComment(commentId: string, body: string): Promise<ReviewComment> {
    const viewer = await this.viewer()
    const d = await this.gql<q.UpdateCommentData>(q.UPDATE_COMMENT, { id: commentId, body })
    const comment = d.updatePullRequestReviewComment?.pullRequestReviewComment
    if (!comment) throw new ForgeError('GitHub did not return the updated comment.', 502)
    return mapComment(comment, viewer.login)
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.gql<q.DeleteCommentData>(q.DELETE_COMMENT, { id: commentId })
  }

  async setFileViewed(prId: string, path: string, viewed: boolean): Promise<FileViewedState> {
    if (viewed) {
      await this.gql<q.MarkViewedData>(q.MARK_VIEWED, { pullRequestId: prId, path })
      return 'VIEWED'
    }
    await this.gql<q.UnmarkViewedData>(q.UNMARK_VIEWED, { pullRequestId: prId, path })
    return 'UNVIEWED'
  }

  async submitReview(
    repo: RepoRef,
    pr: PullRequestRefs,
    input: SubmitReviewRequest,
  ): Promise<SubmitReviewResponse> {
    const viewer = await this.viewer()
    const pending = await this.findPendingReview(repo, pr.number, viewer.login)
    const body = input.body.trim() === '' ? undefined : input.body
    if (input.event !== 'APPROVE' && body === undefined && !(pending && pending.commentCount > 0)) {
      throw new HttpError(400, SUMMARY_REQUIRED, 'bad_request')
    }

    let review: q.RawSubmittedReview | null | undefined
    if (pending) {
      const d = await this.gql<q.SubmitReviewData>(q.SUBMIT_REVIEW, {
        reviewId: pending.id,
        event: input.event,
        ...(body === undefined ? {} : { body }),
      })
      review = d.submitPullRequestReview?.pullRequestReview
    } else {
      const d = await this.gql<q.AddAndSubmitReviewData>(q.ADD_AND_SUBMIT_REVIEW, {
        pullRequestId: pr.id,
        commitOID: pr.headRefOid,
        event: input.event,
        ...(body === undefined ? {} : { body }),
      })
      review = d.addPullRequestReview?.pullRequestReview
    }
    if (!review) throw new ForgeError('GitHub did not return the submitted review.', 502)
    return {
      reviewId: review.id,
      state: asReviewState(review.state) ?? 'COMMENTED',
      ...(review.url ? { url: review.url } : {}),
    }
  }

  async discardPendingReview(repo: RepoRef, number: number): Promise<void> {
    const viewer = await this.viewer()
    const pending = await this.findPendingReview(repo, number, viewer.login)
    if (!pending) return
    await this.gql<q.DiscardReviewData>(q.DISCARD_REVIEW, { reviewId: pending.id })
  }

  /** The viewer's pending review on the PR, or null. */
  private async findPendingReview(
    repo: RepoRef,
    number: number,
    login: string,
  ): Promise<PendingReview | null> {
    const d = await this.gql<q.PendingReviewData>(q.PENDING_REVIEW, {
      owner: repo.owner,
      name: repo.repo,
      number,
      login,
    })
    const pr = d.repository?.pullRequest
    if (!pr) throw prNotFound(repo, number)
    return mapPendingReview(pr.reviews?.nodes)
  }
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

const EMPTY: q.Connection<never> = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }

function compact<T>(nodes: readonly (T | null)[] | null | undefined): T[] {
  return (nodes ?? []).filter((n): n is T => n != null)
}

/** All nodes of a connection: the page already in hand plus every following page. */
async function drain<T>(
  first: q.Connection<T>,
  more: (after: string) => Promise<q.Connection<T>>,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const out = compact(first.nodes)
  let page = first
  for (let n = 1; n < maxPages && page.pageInfo.hasNextPage && page.pageInfo.endCursor; n++) {
    page = await more(page.pageInfo.endCursor)
    out.push(...compact(page.nodes))
  }
  return out
}

// ---------------------------------------------------------------------------
// Mapping GitHub's shapes onto the wire types
// ---------------------------------------------------------------------------

const REVIEW_STATES: ReadonlySet<string> = new Set<ReviewState>([
  'PENDING',
  'COMMENTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'DISMISSED',
])
const CHANGE_TYPES: ReadonlySet<string> = new Set<FileChangeType>([
  'ADDED',
  'DELETED',
  'MODIFIED',
  'RENAMED',
  'COPIED',
  'CHANGED',
])
const VIEWED_STATES: ReadonlySet<string> = new Set<FileViewedState>([
  'VIEWED',
  'UNVIEWED',
  'DISMISSED',
])

const asReviewState = (s: string | null | undefined): ReviewState | undefined =>
  s && REVIEW_STATES.has(s) ? (s as ReviewState) : undefined
const asSide = (s: string | null | undefined): DiffSide => (s === 'LEFT' ? 'LEFT' : 'RIGHT')
const asOptionalSide = (s: string | null | undefined): DiffSide | null =>
  s === 'LEFT' || s === 'RIGHT' ? s : null
const asChangeType = (s: string): FileChangeType =>
  CHANGE_TYPES.has(s) ? (s as FileChangeType) : 'MODIFIED'
const asViewedState = (s: string): FileViewedState =>
  VIEWED_STATES.has(s) ? (s as FileViewedState) : 'UNVIEWED'

/** GitHub renders deleted accounts as "ghost"; a null author maps the same way. */
export function mapActor(a: q.RawActor | null | undefined): Actor {
  if (!a) return { login: 'ghost' }
  return a.avatarUrl ? { login: a.login, avatarUrl: a.avatarUrl } : { login: a.login }
}

/**
 * The viewer's own state on a PR: a PENDING review wins; otherwise the most
 * recently submitted review decides (DISMISSED counts as a plain comment).
 */
export function deriveMyReviewState(
  pending: readonly (unknown | null)[] | null | undefined,
  reviews: readonly (q.RawViewerReview | null)[] | null | undefined,
): MyReviewState {
  if (compact(pending).length > 0) return 'pending'
  let latest: q.RawViewerReview | undefined
  for (const r of compact(reviews)) {
    if (r.state === 'PENDING') continue
    if (!latest || (r.submittedAt ?? '') > (latest.submittedAt ?? '')) latest = r
  }
  switch (latest?.state) {
    case undefined:
      return 'none'
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    default:
      return 'commented'
  }
}

function mapPendingReview(
  nodes: readonly (q.RawPendingReview | null)[] | null | undefined,
): PendingReview | null {
  const node = compact(nodes)[0]
  return node ? { id: node.id, commentCount: node.comments?.totalCount ?? 0 } : null
}

export function mapSummary(pr: q.RawPrSummary): PullRequestSummary {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: mapActor(pr.author),
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    headRefOid: pr.headRefOid,
    baseRefOid: pr.baseRefOid,
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    isDraft: pr.isDraft,
    url: pr.url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    myReviewState: deriveMyReviewState(pr.pendingReview?.nodes, pr.viewerReviews?.nodes),
  }
}

export function mapCommit(c: q.RawCommit): Commit {
  const login = c.commit.author?.user?.login
  return {
    oid: c.commit.oid,
    abbreviatedOid: c.commit.abbreviatedOid,
    messageHeadline: c.commit.messageHeadline,
    messageBody: c.commit.messageBody,
    authorName: c.commit.author?.name ?? login ?? 'unknown',
    ...(login ? { authorLogin: login } : {}),
    committedDate: c.commit.committedDate,
    url: c.url || c.commit.url,
  }
}

export function mapFile(f: q.RawFile): ChangedFile {
  return {
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    changeType: asChangeType(f.changeType),
    viewedState: asViewedState(f.viewerViewedState),
  }
}

export function mapComment(c: q.RawReviewComment, viewerLogin: string): ReviewComment {
  const review = c.pullRequestReview
  return {
    id: c.id,
    ...(typeof c.databaseId === 'number' ? { databaseId: c.databaseId } : {}),
    body: c.body,
    bodyHTML: c.bodyHTML,
    author: mapActor(c.author),
    createdAt: c.createdAt,
    ...(c.url ? { url: c.url } : {}),
    ...(review ? { reviewId: review.id } : {}),
    ...(asReviewState(review?.state) ? { reviewState: asReviewState(review?.state) } : {}),
    isPending: c.state === 'PENDING' || review?.state === 'PENDING',
    isMine: c.author?.login === viewerLogin,
  }
}

export function mapThread(t: q.RawThread, comments: ReviewComment[]): ReviewThread {
  return {
    id: t.id,
    path: t.path,
    line: t.line,
    startLine: t.startLine,
    side: asSide(t.diffSide),
    startSide: asOptionalSide(t.startDiffSide),
    originalLine: t.originalLine,
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    comments,
  }
}

/**
 * The Overview conversation: issue comments plus submitted reviews, oldest
 * first. The viewer's PENDING review is excluded (it is not public), and so
 * are reviews that carry neither a body nor inline comments (pure approvals
 * still have a state and are kept).
 */
export function buildConversation(
  comments: readonly q.RawIssueComment[],
  reviews: readonly q.RawReview[],
): ConversationItem[] {
  const items: { at: number; item: ConversationItem }[] = []
  for (const c of comments) {
    items.push({
      at: Date.parse(c.createdAt),
      item: {
        kind: 'comment',
        id: c.id,
        author: mapActor(c.author),
        body: c.body,
        bodyHTML: c.bodyHTML,
        createdAt: c.createdAt,
        ...(c.url ? { url: c.url } : {}),
      },
    })
  }
  for (const r of reviews) {
    if (r.state === 'PENDING') continue
    const commentCount = r.comments?.totalCount ?? 0
    if (r.body.trim() === '' && commentCount === 0 && r.state === 'COMMENTED') continue
    items.push({
      at: Date.parse(r.submittedAt ?? r.createdAt),
      item: {
        kind: 'review',
        id: r.id,
        author: mapActor(r.author),
        body: r.body,
        bodyHTML: r.bodyHTML,
        state: asReviewState(r.state) ?? 'COMMENTED',
        submittedAt: r.submittedAt,
        ...(r.url ? { url: r.url } : {}),
        commentCount,
      },
    })
  }
  items.sort((a, b) => a.at - b.at)
  return items.map((x) => x.item)
}

const repoNotFound = (repo: RepoRef) =>
  new ForgeError(`Repository ${repo.owner}/${repo.repo} was not found on GitHub.`, 404)
const prNotFound = (repo: RepoRef, number: number) =>
  new ForgeError(`Pull request #${number} was not found in ${repo.owner}/${repo.repo}.`, 404)
