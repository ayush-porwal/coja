/**
 * Wire types shared between the server and the web UI.
 *
 * The web package imports this directory through the `@coja/shared/*` alias
 * (tsconfig `paths` + Vite `resolve.alias`), so keep it free of Node and DOM
 * imports: it must compile in both environments.
 *
 * This file is the contract between the two packages. Server routes implement
 * it; the UI consumes it. Change it deliberately, in one place.
 */

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const pr = (projectId: string, number: number) =>
  `/api/projects/${encodeURIComponent(projectId)}/prs/${number}`

export const API_ROUTES = {
  health: '/api/health',

  // Setup
  /** GET → SetupStatus */
  setupStatus: '/api/setup/status',
  /** POST SaveKeyRequest → SaveKeyResponse (validates the key with the provider first) */
  setupKey: '/api/setup/key',
  /** DELETE → { ok: true } (query: ?provider=openai|anthropic) */
  setupKeyDelete: (provider: ProviderId) => `/api/setup/key?provider=${provider}`,
  /** POST → SetupStatus. Marks the AI step done (saved a key or skipped). */
  setupComplete: '/api/setup/complete',

  // Projects
  /** GET → Project[] ; POST AddProjectRequest → Project */
  projects: '/api/projects',
  /** GET → Project ; DELETE → { ok: true } */
  project: (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`,

  // Pull requests
  /** GET → PullRequestSummary[] (open PRs, newest update first) */
  prs: (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/prs`,
  /** GET → PullRequestDetail */
  pr,
  /** POST → FetchStatus (starts a background `git fetch` if needed; idempotent). GET → FetchStatus */
  prFetch: (projectId: string, number: number) => `${pr(projectId, number)}/fetch`,
  /** GET → GitChangedFile[] (from git, once the fetch is ready) */
  prGitFiles: (projectId: string, number: number) => `${pr(projectId, number)}/git-files`,
  /** GET ?path=&previousPath= → FileDiffResponse */
  prDiff: (projectId: string, number: number) => `${pr(projectId, number)}/diff`,
  /** GET ?ref=base|head&path=&start=&end= → BlobResponse */
  prBlob: (projectId: string, number: number) => `${pr(projectId, number)}/blob`,

  // Review sync (all of these hit GitHub immediately; GitHub is the source of truth)
  /** POST AddCommentRequest → AddCommentResponse (creates the pending review if needed) */
  prComments: (projectId: string, number: number) => `${pr(projectId, number)}/comments`,
  /** PATCH UpdateCommentRequest → ReviewComment ; DELETE → { ok: true } */
  prComment: (projectId: string, number: number, commentId: string) =>
    `${pr(projectId, number)}/comments/${encodeURIComponent(commentId)}`,
  /** POST ReplyRequest → ReplyResponse */
  prThreadReplies: (projectId: string, number: number, threadId: string) =>
    `${pr(projectId, number)}/threads/${encodeURIComponent(threadId)}/replies`,
  /** POST SetViewedRequest → SetViewedResponse */
  prViewed: (projectId: string, number: number) => `${pr(projectId, number)}/viewed`,
  /** POST SubmitReviewRequest → SubmitReviewResponse ; DELETE → { ok: true } (discard pending review) */
  prReview: (projectId: string, number: number) => `${pr(projectId, number)}/review`,

  // AI
  /** GET → ModelInfo[] (only providers with a configured key) */
  aiModels: '/api/ai/models',
  /** GET → AiContextResponse — "what does the AI see?" */
  prAiContext: (projectId: string, number: number) => `${pr(projectId, number)}/ai-context`,
  /** GET → Chat[] ; POST NewChatRequest → Chat */
  prChats: (projectId: string, number: number) => `${pr(projectId, number)}/chats`,
  /** GET → ChatWithMessages ; DELETE → { ok: true } */
  prChat: (projectId: string, number: number, chatId: string) =>
    `${pr(projectId, number)}/chats/${encodeURIComponent(chatId)}`,
  /**
   * POST ChatRequest → UI message stream (Vercel AI SDK).
   * The server persists the full conversation when the turn finishes.
   */
  prChatMessages: (projectId: string, number: number, chatId: string) =>
    `${pr(projectId, number)}/chats/${encodeURIComponent(chatId)}/messages`,
} as const

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: true
  version: string
}

/** Every non-2xx API response has this JSON body. */
export interface ApiError {
  error: string
  /** Stable machine-readable code when the UI needs to branch on it. */
  code?: 'gh_not_authenticated' | 'not_found' | 'bad_request' | 'github' | 'git' | 'provider'
}

export interface Actor {
  login: string
  avatarUrl?: string
}

export type DiffSide = 'LEFT' | 'RIGHT'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export type ProviderId = 'openai' | 'anthropic'

export const PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic']

export interface GhAuthStatus {
  ok: boolean
  /** Present when ok. */
  login?: string
  host?: string
  /** Human-readable reason when not ok (e.g. `gh` missing, or not logged in). */
  error?: string
}

export interface SetupStatus {
  gh: GhAuthStatus
  providers: Record<ProviderId, { configured: boolean }>
  secrets: {
    /** 'keychain' when the OS keychain works; 'file' when we fell back to a 0600 file in the data dir. */
    backend: 'keychain' | 'file'
  }
  /** True once the user has saved a key or explicitly skipped the AI step. */
  setupComplete: boolean
}

export interface SaveKeyRequest {
  provider: ProviderId
  apiKey: string
}

export interface SaveKeyResponse {
  ok: true
  provider: ProviderId
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectKind = 'local' | 'clone'

export interface Project {
  id: string
  kind: ProjectKind
  owner: string
  repo: string
  /**
   * Absolute path git is invoked in (`git -C <path>`): the user's clone for
   * `local`, the app-managed bare clone for `clone`.
   */
  path: string
  createdAt: string
}

export type AddProjectRequest =
  | { kind: 'local'; path: string }
  | { kind: 'clone'; slug: string /* owner/repo, or a github.com URL */ }

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export type MyReviewState = 'none' | 'pending' | 'approved' | 'changes_requested' | 'commented'

export interface PullRequestSummary {
  /** GraphQL node id. */
  id: string
  number: number
  title: string
  author: Actor
  headRefName: string
  baseRefName: string
  headRefOid: string
  baseRefOid: string
  updatedAt: string
  createdAt: string
  isDraft: boolean
  url: string
  additions: number
  deletions: number
  changedFiles: number
  /** The viewer's own review state on this PR. */
  myReviewState: MyReviewState
}

export type FileChangeType = 'ADDED' | 'DELETED' | 'MODIFIED' | 'RENAMED' | 'COPIED' | 'CHANGED'

export type FileViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED'

export interface ChangedFile {
  path: string
  additions: number
  deletions: number
  changeType: FileChangeType
  viewedState: FileViewedState
}

export interface Commit {
  oid: string
  abbreviatedOid: string
  messageHeadline: string
  messageBody: string
  authorName: string
  authorLogin?: string
  committedDate: string
  url: string
}

export type ReviewState = 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED'

export interface ReviewComment {
  id: string
  databaseId?: number
  body: string
  bodyHTML: string
  author: Actor
  createdAt: string
  url?: string
  /** The review this comment belongs to, when any. */
  reviewId?: string
  reviewState?: ReviewState
  /** True when it belongs to the viewer's PENDING review (invisible to others). */
  isPending: boolean
  /** True when the viewer wrote it (enables edit/delete). */
  isMine: boolean
}

export interface ReviewThread {
  id: string
  path: string
  /** Current line on the given side; null when the thread is outdated (code moved). */
  line: number | null
  startLine: number | null
  side: DiffSide
  startSide: DiffSide | null
  originalLine: number | null
  isResolved: boolean
  isOutdated: boolean
  comments: ReviewComment[]
}

export type ConversationItem =
  | {
      kind: 'comment'
      id: string
      author: Actor
      body: string
      bodyHTML: string
      createdAt: string
      url?: string
    }
  | {
      kind: 'review'
      id: string
      author: Actor
      body: string
      bodyHTML: string
      state: ReviewState
      submittedAt: string | null
      url?: string
      commentCount: number
    }

export interface PendingReview {
  id: string
  commentCount: number
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string
  bodyHTML: string
  commits: Commit[]
  files: ChangedFile[]
  threads: ReviewThread[]
  conversation: ConversationItem[]
  /** The viewer's pending review, if one exists. */
  pendingReview: PendingReview | null
  viewer: Actor
}

// ---------------------------------------------------------------------------
// Git objects (fetch, diff, blobs)
// ---------------------------------------------------------------------------

export type FetchState = 'idle' | 'fetching' | 'ready' | 'error'

export interface FetchStatus {
  state: FetchState
  /** Resolved once `ready`. */
  headOid?: string
  baseOid?: string
  mergeBaseOid?: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

/** Status letters from `git diff --name-status -M`. */
export type GitChangeStatus = 'A' | 'D' | 'M' | 'R' | 'C' | 'T'

export interface GitChangedFile {
  path: string
  previousPath?: string
  status: GitChangeStatus
}

export interface FileDiffResponse {
  path: string
  previousPath?: string
  /** Unified patch for this one file (`git diff <mergeBase> <head> -- <paths>`), or '' for binary/too-large files. */
  patch: string
  binary: boolean
  /** True when the patch was withheld because it exceeded the size cap. */
  tooLarge: boolean
}

export type PrRef = 'base' | 'head'

export interface BlobResponse {
  ref: PrRef
  oid: string
  path: string
  /** 1-based, inclusive. Present when the request asked for a range. */
  startLine?: number
  endLine?: number
  text: string
  /** Total line count of the file at that ref. */
  lineCount: number
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

export interface AddCommentRequest {
  path: string
  body: string
  /** End line of the range (or the single line). File-side numbering per `side`. */
  line: number
  side: DiffSide
  startLine?: number
  startSide?: DiffSide
}

export interface AddCommentResponse {
  thread: ReviewThread
  pendingReview: PendingReview
}

export interface UpdateCommentRequest {
  body: string
}

export interface ReplyRequest {
  body: string
}

export interface ReplyResponse {
  comment: ReviewComment
  threadId: string
}

export interface SetViewedRequest {
  path: string
  viewed: boolean
}

export interface SetViewedResponse {
  path: string
  viewedState: FileViewedState
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface SubmitReviewRequest {
  event: ReviewEvent
  body: string
}

export interface SubmitReviewResponse {
  reviewId: string
  state: ReviewState
  url?: string
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface ModelInfo {
  /** `<provider>:<model id>`, e.g. `openai:gpt-5-mini`. */
  id: string
  provider: ProviderId
  modelId: string
  label: string
}

export interface Chat {
  id: string
  projectId: string
  prNumber: number
  /** First user message, trimmed; null until the first message. */
  title: string | null
  model: string
  createdAt: string
  updatedAt: string
}

export interface NewChatRequest {
  model?: string
}

/**
 * A context chip attached to a user message. `text` is the exact excerpt sent
 * to the model, so the UI can show precisely what the model received.
 *
 * Chips travel as Vercel AI SDK data parts on the user UIMessage:
 * `{ type: 'data-chip', id: chip.id, data: ContextChip }`. The server converts
 * each one to a text part for the model (`convertDataPart`); the stored UI
 * message keeps the chip as-is so the UI can render and expand it.
 */
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

/** Data part types on chat UIMessages (`UIMessage<ChatMessageMetadata, ChatDataParts, …>`). */
export interface ChatDataParts {
  chip: ContextChip
  [key: string]: unknown
}

/** `UIMessage.metadata` shape for both user and assistant messages. */
export interface ChatMessageMetadata {
  /** `<provider>:<model id>` used for the assistant turn. */
  model?: string
  createdAt?: string
}

/**
 * Body of POST prChatMessages. `messages` is the Vercel AI SDK UIMessage[]
 * (typed loosely here to keep this file free of the `ai` dependency).
 */
export interface ChatRequest {
  messages: unknown[]
  model: string
}

export interface ChatWithMessages {
  chat: Chat
  messages: unknown[]
}

export interface AiContextResponse {
  /** The standing system prompt, verbatim. */
  system: string
  /** Tool names and one-line descriptions, for the "what does the AI see?" affordance. */
  tools: { name: string; description: string }[]
}
