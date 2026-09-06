/**
 * GraphQL documents for the GitHub forge, plus the raw response shapes they
 * select (the `Raw*` / `*Data` types). Field names, argument names and enum
 * values were verified against the live schema by introspection; a document
 * and its data type must be changed together.
 *
 * Paging: every connection is requested with `first: 100` (GitHub's maximum)
 * and exposes `pageInfo`; `*Page` documents fetch the following pages of one
 * connection so the initial detail query is never repeated.
 */

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

const PR_SUMMARY = /* GraphQL */ `
fragment PrSummary on PullRequest {
  id number title url isDraft createdAt updatedAt
  additions deletions changedFiles
  author { login avatarUrl }
  headRefName baseRefName headRefOid baseRefOid
  viewerReviews: reviews(author: $login, last: 20) { nodes { id state submittedAt } }
  pendingReview: reviews(author: $login, states: [PENDING], first: 1) {
    nodes { id comments(first: 1) { totalCount } }
  }
}`

const COMMENT_FIELDS = /* GraphQL */ `
fragment CommentFields on PullRequestReviewComment {
  id databaseId body bodyHTML createdAt url state
  author { login avatarUrl }
  pullRequestReview { id state }
}`

const THREAD_FIELDS = /* GraphQL */ `
fragment ThreadFields on PullRequestReviewThread {
  id path line startLine originalLine diffSide startDiffSide isResolved isOutdated
  comments(first: 100) {
    pageInfo { hasNextPage endCursor }
    nodes { ...CommentFields }
  }
}
${COMMENT_FIELDS}`

const REVIEW_FIELDS = /* GraphQL */ `
fragment ReviewFields on PullRequestReview {
  id state body bodyHTML submittedAt createdAt url
  author { login avatarUrl }
  comments(first: 1) { totalCount }
}`

const ISSUE_COMMENT_FIELDS = /* GraphQL */ `
fragment IssueCommentFields on IssueComment {
  id body bodyHTML createdAt url
  author { login avatarUrl }
}`

const COMMIT_FIELDS = /* GraphQL */ `
fragment CommitFields on PullRequestCommit {
  url
  commit {
    oid abbreviatedOid messageHeadline messageBody committedDate url
    author { name user { login } }
  }
}`

const FILE_FIELDS = 'path additions deletions changeType viewerViewedState'

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const VIEWER = /* GraphQL */ `
query Viewer { viewer { login avatarUrl } }`

/** Open PRs, most recently updated first. Variables: owner, name, login, after? */
export const PR_LIST = /* GraphQL */ `
query PrList($owner: String!, $name: String!, $login: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: [OPEN], first: 100, after: $after,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      ${PAGE_INFO}
      nodes { ...PrSummary }
    }
  }
}
${PR_SUMMARY}`

/**
 * Filtered open PRs via GitHub's search API. The caller builds the query
 * string (repo/is:pr/is:open plus qualifiers); search order is best-match,
 * like GitHub's own filtered list. Variables: query (the full string),
 * login, after?
 */
export const PR_SEARCH = /* GraphQL */ `
query PrSearch($query: String!, $login: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ...PrSummary } }
  }
}
${PR_SUMMARY}`

/** Variables: owner, name, number */
export const PR_REFS = /* GraphQL */ `
query PrRefs($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id number headRefOid baseRefOid baseRefName headRefName }
  }
}`

/** First page of everything the review screen needs. Variables: owner, name, number, login */
export const PR_DETAIL = /* GraphQL */ `
query PrDetail($owner: String!, $name: String!, $number: Int!, $login: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ...PrSummary
      body bodyHTML
      commits(first: 100) { totalCount ${PAGE_INFO} nodes { ...CommitFields } }
      files(first: 100) { totalCount ${PAGE_INFO} nodes { ${FILE_FIELDS} } }
      reviewThreads(first: 100) { totalCount ${PAGE_INFO} nodes { ...ThreadFields } }
      reviews(first: 100) { ${PAGE_INFO} nodes { ...ReviewFields } }
      comments(first: 100) { ${PAGE_INFO} nodes { ...IssueCommentFields } }
    }
  }
}
${PR_SUMMARY}
${COMMIT_FIELDS}
${THREAD_FIELDS}
${REVIEW_FIELDS}
${ISSUE_COMMENT_FIELDS}`

const pageQuery = (name: string, connection: string, fragments = '') => /* GraphQL */ `
query ${name}($owner: String!, $name: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ${connection} }
  }
}
${fragments}`

/** Variables: owner, name, number, after */
export const PR_COMMITS_PAGE = pageQuery(
  'PrCommitsPage',
  `commits(first: 100, after: $after) { ${PAGE_INFO} nodes { ...CommitFields } }`,
  COMMIT_FIELDS,
)
export const PR_FILES_PAGE = pageQuery(
  'PrFilesPage',
  `files(first: 100, after: $after) { ${PAGE_INFO} nodes { ${FILE_FIELDS} } }`,
)
export const PR_THREADS_PAGE = pageQuery(
  'PrThreadsPage',
  `reviewThreads(first: 100, after: $after) { ${PAGE_INFO} nodes { ...ThreadFields } }`,
  THREAD_FIELDS,
)
export const PR_REVIEWS_PAGE = pageQuery(
  'PrReviewsPage',
  `reviews(first: 100, after: $after) { ${PAGE_INFO} nodes { ...ReviewFields } }`,
  REVIEW_FIELDS,
)
export const PR_ISSUE_COMMENTS_PAGE = pageQuery(
  'PrIssueCommentsPage',
  `comments(first: 100, after: $after) { ${PAGE_INFO} nodes { ...IssueCommentFields } }`,
  ISSUE_COMMENT_FIELDS,
)

/** Comments of one thread beyond its first 100. Variables: id (thread node id), after */
export const THREAD_COMMENTS_PAGE = /* GraphQL */ `
query ThreadCommentsPage($id: ID!, $after: String!) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $after) { ${PAGE_INFO} nodes { ...CommentFields } }
    }
  }
}
${COMMENT_FIELDS}`

/**
 * The pull request a review comment / thread belongs to, for tying a
 * client-supplied node id to the PR named in the route. Two documents, so an id
 * of the other type resolves to no pull request at all. Variables: id
 */
const ownerQuery = (name: string, type: string) => /* GraphQL */ `
query ${name}($id: ID!) {
  node(id: $id) {
    ... on ${type} { pullRequest { number repository { name owner { login } } } }
  }
}`
export const COMMENT_OWNER = ownerQuery('CommentOwner', 'PullRequestReviewComment')
export const THREAD_OWNER = ownerQuery('ThreadOwner', 'PullRequestReviewThread')

/** The viewer's pending review on a PR, if any. Variables: owner, name, number, login */
export const PENDING_REVIEW = /* GraphQL */ `
query PendingReview($owner: String!, $name: String!, $number: Int!, $login: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      reviews(author: $login, states: [PENDING], first: 1) {
        nodes { id comments(first: 1) { totalCount } }
      }
    }
  }
}`

// ---------------------------------------------------------------------------
// Mutations — every one of these is reached only from an HTTP route handler
// that a human triggered in the UI ("the AI drafts, the human sends").
// ---------------------------------------------------------------------------

/** Create a PENDING review anchored at a commit (no event). Variables: pullRequestId, commitOID */
export const START_REVIEW = /* GraphQL */ `
mutation StartReview($pullRequestId: ID!, $commitOID: GitObjectID) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
    pullRequestReview { id state }
  }
}`

/**
 * Add a line/range thread to a pending review. Variables: input
 * (AddPullRequestReviewThreadInput: pullRequestReviewId, path, body, line, side, startLine?, startSide?).
 * `firstComment` reaches the owning review's updated comment count.
 */
export const ADD_THREAD = /* GraphQL */ `
mutation AddThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread {
      ...ThreadFields
      firstComment: comments(first: 1) {
        nodes { pullRequestReview { id comments(first: 1) { totalCount } } }
      }
    }
  }
}
${THREAD_FIELDS}`

/**
 * Reply to a thread without a pullRequestReviewId (decisions.md). Verified live: when the viewer
 * has no pending review GitHub creates and submits a one-comment review, so the reply is public
 * at once; when a pending review exists GitHub attaches the reply to it (state PENDING) and it
 * publishes with the review. Variables: threadId, body
 */
export const REPLY = /* GraphQL */ `
mutation Reply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      ...CommentFields
      pullRequestReview { id state comments(first: 1) { totalCount } }
    }
  }
}
${COMMENT_FIELDS}`

/** Variables: id, body */
export const UPDATE_COMMENT = /* GraphQL */ `
mutation UpdateComment($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { ...CommentFields }
  }
}
${COMMENT_FIELDS}`

/** Variables: id */
export const DELETE_COMMENT = /* GraphQL */ `
mutation DeleteComment($id: ID!) {
  deletePullRequestReviewComment(input: { id: $id }) {
    pullRequestReviewComment { id }
  }
}`

/** Submit an existing pending review. Variables: reviewId, event, body? */
export const SUBMIT_REVIEW = /* GraphQL */ `
mutation SubmitReview($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestReviewId: $reviewId, event: $event, body: $body }) {
    pullRequestReview { id state url }
  }
}`

/** Create and submit a review in one call (no pending review exists). Variables: pullRequestId, commitOID, event, body? */
export const ADD_AND_SUBMIT_REVIEW = /* GraphQL */ `
mutation AddAndSubmitReview($pullRequestId: ID!, $commitOID: GitObjectID, $event: PullRequestReviewEvent!, $body: String) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID, event: $event, body: $body }) {
    pullRequestReview { id state url }
  }
}`

/** Delete a pending review and all its draft comments. Variables: reviewId */
export const DISCARD_REVIEW = /* GraphQL */ `
mutation DiscardReview($reviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $reviewId }) {
    pullRequestReview { id }
  }
}`

/** Variables: pullRequestId, path */
export const MARK_VIEWED = /* GraphQL */ `
mutation MarkViewed($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { pullRequest { id } }
}`

/** Variables: pullRequestId, path */
export const UNMARK_VIEWED = /* GraphQL */ `
mutation UnmarkViewed($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { pullRequest { id } }
}`

// ---------------------------------------------------------------------------
// Raw response shapes (exactly what the documents above select)
// ---------------------------------------------------------------------------

export interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

export interface Connection<T> {
  totalCount?: number
  pageInfo: PageInfo
  nodes: (T | null)[] | null
}

export interface RawActor {
  login: string
  avatarUrl?: string | null
}

export interface RawViewerReview {
  id: string
  state: string
  submittedAt: string | null
}

export interface RawPendingReview {
  id: string
  comments: { totalCount: number } | null
}

export interface RawPrSummary {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
  author: RawActor | null
  headRefName: string
  baseRefName: string
  headRefOid: string
  baseRefOid: string
  viewerReviews: { nodes: (RawViewerReview | null)[] | null } | null
  pendingReview: { nodes: (RawPendingReview | null)[] | null } | null
}

export interface RawCommit {
  url: string
  commit: {
    oid: string
    abbreviatedOid: string
    messageHeadline: string
    messageBody: string
    committedDate: string
    url: string
    author: { name: string | null; user: { login: string } | null } | null
  }
}

export interface RawFile {
  path: string
  additions: number
  deletions: number
  changeType: string
  viewerViewedState: string
}

export interface RawReviewComment {
  id: string
  databaseId: number | null
  body: string
  bodyHTML: string
  createdAt: string
  url: string | null
  state: string
  author: RawActor | null
  pullRequestReview: { id: string; state: string } | null
}

export interface RawThread {
  id: string
  path: string
  line: number | null
  startLine: number | null
  originalLine: number | null
  diffSide: string
  startDiffSide: string | null
  isResolved: boolean
  isOutdated: boolean
  comments: Connection<RawReviewComment>
}

export interface RawReview {
  id: string
  state: string
  body: string
  bodyHTML: string
  submittedAt: string | null
  createdAt: string
  url: string | null
  author: RawActor | null
  comments: { totalCount: number } | null
}

export interface RawIssueComment {
  id: string
  body: string
  bodyHTML: string
  createdAt: string
  url: string | null
  author: RawActor | null
}

export interface RawPrDetail extends RawPrSummary {
  body: string
  bodyHTML: string
  commits: Connection<RawCommit>
  files: Connection<RawFile>
  reviewThreads: Connection<RawThread>
  reviews: Connection<RawReview>
  comments: Connection<RawIssueComment>
}

export interface RawPrRefs {
  id: string
  number: number
  headRefOid: string
  baseRefOid: string
  baseRefName: string
  headRefName: string
}

export interface RawSubmittedReview {
  id: string
  state: string
  url: string | null
}

export interface ViewerData {
  viewer: { login: string; avatarUrl: string | null }
}
export interface PrListData {
  repository: { pullRequests: Connection<RawPrSummary> } | null
}
export interface PrSearchData {
  search: (Connection<RawPrSummary> & { issueCount?: number }) | null
}
export interface PrRefsData {
  repository: { pullRequest: RawPrRefs | null } | null
}
export interface PrDetailData {
  repository: { pullRequest: RawPrDetail | null } | null
}
export interface PrCommitsPageData {
  repository: { pullRequest: { commits: Connection<RawCommit> } | null } | null
}
export interface PrFilesPageData {
  repository: { pullRequest: { files: Connection<RawFile> } | null } | null
}
export interface PrThreadsPageData {
  repository: { pullRequest: { reviewThreads: Connection<RawThread> } | null } | null
}
export interface PrReviewsPageData {
  repository: { pullRequest: { reviews: Connection<RawReview> } | null } | null
}
export interface PrIssueCommentsPageData {
  repository: { pullRequest: { comments: Connection<RawIssueComment> } | null } | null
}
export interface ThreadCommentsPageData {
  node: { comments?: Connection<RawReviewComment> } | null
}
export interface NodeOwnerData {
  node: {
    pullRequest?: { number: number; repository: { name: string; owner: { login: string } } } | null
  } | null
}
export interface PendingReviewData {
  repository: {
    pullRequest: {
      id: string
      reviews: { nodes: (RawPendingReview | null)[] | null } | null
    } | null
  } | null
}
export interface StartReviewData {
  addPullRequestReview: { pullRequestReview: { id: string; state: string } | null } | null
}
export interface RawAddedThread extends RawThread {
  firstComment: {
    nodes:
      | ({
          pullRequestReview: { id: string; comments: { totalCount: number } | null } | null
        } | null)[]
      | null
  } | null
}
export interface AddThreadData {
  addPullRequestReviewThread: { thread: RawAddedThread | null } | null
}
/** A posted reply: `CommentFields` plus the owning review's comment count. */
export interface RawReplyComment extends RawReviewComment {
  pullRequestReview: { id: string; state: string; comments: { totalCount: number } | null } | null
}
export interface ReplyData {
  addPullRequestReviewThreadReply: { comment: RawReplyComment | null } | null
}
export interface UpdateCommentData {
  updatePullRequestReviewComment: { pullRequestReviewComment: RawReviewComment | null } | null
}
export interface DeleteCommentData {
  deletePullRequestReviewComment: { pullRequestReviewComment: { id: string } | null } | null
}
export interface SubmitReviewData {
  submitPullRequestReview: { pullRequestReview: RawSubmittedReview | null } | null
}
export interface AddAndSubmitReviewData {
  addPullRequestReview: { pullRequestReview: RawSubmittedReview | null } | null
}
export interface DiscardReviewData {
  deletePullRequestReview: { pullRequestReview: { id: string } | null } | null
}
export interface MarkViewedData {
  markFileAsViewed: { pullRequest: { id: string } | null } | null
}
export interface UnmarkViewedData {
  unmarkFileAsViewed: { pullRequest: { id: string } | null } | null
}
