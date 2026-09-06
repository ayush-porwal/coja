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
  /** POST AddCustomProviderRequest → { customProviders } — a user-added endpoint. */
  setupCustomProviders: '/api/setup/custom-providers',
  /** DELETE → { ok: true } — removes the provider config and its stored key. */
  setupCustomProviderDelete: (id: string) =>
    `/api/setup/custom-providers/${encodeURIComponent(id)}`,
  /**
   * POST FetchCustomModelsRequest → FetchCustomModelsResponse — asks the
   * endpoint for its model list. Best effort: many compatible endpoints
   * don't implement it, and the form's manual entry always works.
   */
  setupCustomModels: '/api/setup/custom-providers/models',
  /** POST → SetupStatus. Marks the AI step done (saved a key or skipped). */
  setupComplete: '/api/setup/complete',

  // ChatGPT subscription
  /** POST → { ok: true, authUrl } — starts the browser sign-in flow. */
  setupChatgptConnect: '/api/setup/chatgpt/connect',
  /** GET → ChatGptConnectStatus — polled while the browser flow is open. */
  setupChatgptStatus: '/api/setup/chatgpt/status',
  /** DELETE → { ok: true } — forget tokens (there is no upstream revoke). */
  setupChatgptDisconnect: '/api/setup/chatgpt/disconnect',

  // Projects
  /** GET → Project[] ; POST AddProjectRequest → Project */
  projects: '/api/projects',
  /** GET → Project ; DELETE → { ok: true } */
  project: (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`,

  // Filesystem browsing (Add project → local clone)
  /** GET → { home: string } — the server user's home directory, the picker's start point. */
  fsHome: '/api/fs/home',
  /** GET ?path=&prefix=&limit= → DirListing — subdirectories of `path`, names only, capped. */
  fsDirs: '/api/fs/dirs',

  // Pull requests
  /**
   * GET ?page=1&text=&author=&head=&base=&draft=true|false → PullRequestPage
   * (open PRs, newest update first, 100 per page; filters are server-side).
   */
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

/** Wire protocol a custom endpoint speaks. */
export type CustomApiFormat = 'openai' | 'anthropic'

/**
 * A user-added model provider (Setup → "Add model provider"): any endpoint
 * that speaks the OpenAI chat-completions or the Anthropic messages protocol
 * at a custom base URL — DeepSeek, OpenRouter, an Anthropic proxy, a local
 * Ollama/LM Studio. Models are curated by hand: there is no assumed
 * models-list endpoint to discover them from.
 */
/** One model of a custom provider: the wire id plus an optional display name. */
export interface CustomProviderModel {
  /** Sent to the endpoint, e.g. `glm-5.3-flash`. */
  id: string
  /** Shown in the model picker, e.g. `GLM-5.3-Flash`. Defaults to the id. */
  label?: string
}

export interface CustomProviderConfig {
  /** `custom-<slug of name>`. Also the keychain account namespace. */
  id: string
  name: string
  /** Includes the path prefix, e.g. `https://api.deepseek.com/v1`. */
  baseUrl: string
  apiFormat: CustomApiFormat
  /** The user's curated models: ids sent to the API, labels shown in the picker. */
  models: CustomProviderModel[]
}

/**
 * POST /api/setup/custom-providers body. The key is stored, never returned.
 * Key semantics: a non-empty `apiKey` stores/replaces the stored key; an
 * absent or empty one leaves any stored key untouched (so an edit that only
 * renames or re-models a provider does not silently drop its key).
 */
export interface AddCustomProviderRequest {
  name: string
  baseUrl: string
  apiFormat: CustomApiFormat
  /**
   * Ids with optional display names. Strings are accepted too (an id with no
   * label) — the server normalizes everything to `CustomProviderModel`.
   */
  models: (string | CustomProviderModel)[]
  /** Optional: local endpoints (Ollama) often need none. */
  apiKey?: string
}

/** A config plus whether a key is stored — facts only, never key material. */
export type CustomProviderSummary = CustomProviderConfig & { hasKey: boolean }

/** POST /api/setup/custom-providers response. */
export interface CustomProvidersResponse {
  customProviders: CustomProviderSummary[]
}

/**
 * POST /api/setup/custom-providers/models body. Either an existing provider
 * id (its stored key is used when no key is typed — the form never shows it
 * again) or an explicit base URL + format with an optional key.
 */
export interface FetchCustomModelsRequest {
  id?: string
  baseUrl?: string
  apiFormat?: CustomApiFormat
  apiKey?: string
}

export interface FetchedCustomModel {
  id: string
  /** The endpoint's display name, when it offers one (Anthropic does). */
  label?: string
}

export interface FetchCustomModelsResponse {
  models: FetchedCustomModel[]
}

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
  /** User-added custom endpoints, configs only — keys never leave the server. */
  customProviders: CustomProviderSummary[]
  secrets: {
    /** 'keychain' when the OS keychain works; 'file' when we fell back to a 0600 file in the data dir. */
    backend: 'keychain' | 'file'
  }
  /** True once the user has saved a key or explicitly skipped the AI step. */
  setupComplete: boolean
  /** ChatGPT-subscription connection; `connected` mirrors `providers.chatgpt.configured`. */
  chatgpt: ChatGptConnectionStatus
}

/** Connection facts only — never token material. */
export interface ChatGptConnectionStatus {
  connected: boolean
  /** Unverified account metadata from the signed-in token's JWT claims. */
  email?: string
  plan?: string
  /** A refresh died terminally: the user must reconnect. */
  authExpired?: boolean
  /** Failure of the last sign-in attempt (port busy, cancelled, refused). */
  connectError?: string
}

/** Live state of the browser sign-in flow, polled by the Setup screen. */
export interface ChatGptConnectStatus {
  status: 'connecting' | 'connected' | 'idle'
  connected: boolean
  email?: string
  plan?: string
  authExpired?: boolean
  connectError?: string
}

// ---------------------------------------------------------------------------
// ChatGPT-subscription error marker (server → web convention)
// ---------------------------------------------------------------------------

export type ChatGptErrorCode =
  | 'state_mismatch'
  | 'auth_expired'
  | 'quota'
  | 'endpoint_changed'
  | 'transport'

/**
 * Chat-turn failures of the subscription provider reach the browser as the
 * stream's error text. Codex failures are self-marked with this prefix so the
 * chat panel can offer honest actions (reconnect, switch to an API key)
 * without the chat handler knowing which billing path is active.
 */
export const CHATGPT_MARKER_PREFIX = '[coja:chatgpt:'

export const CHATGPT_MARKER_PATTERN =
  /^\[coja:chatgpt:(state_mismatch|auth_expired|quota|endpoint_changed|transport)\]\s?/

export const markChatGptError = (code: ChatGptErrorCode, message: string): string =>
  `${CHATGPT_MARKER_PREFIX}${code}] ${message}`

export function parseChatGptMarker(
  message: string,
): { code: ChatGptErrorCode; text: string } | null {
  const match = CHATGPT_MARKER_PATTERN.exec(message)
  if (!match) return null
  return { code: match[1] as ChatGptErrorCode, text: message.slice(match[0].length) }
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

/** One subdirectory in a `DirListing`. `hasGit` marks a likely clone (a `.git` entry). */
export interface DirEntry {
  name: string
  hasGit: boolean
}

/**
 * Subdirectories of one directory — the Add-project picker's building block.
 * Deliberately names only: no files, no contents, no disk-wide search. `dirs`
 * is capped (`limit`, default ${'`'}500${'`'}); `total`/`truncated` describe the pre-cap match count.
 */
export interface DirListing {
  path: string
  /** The parent directory, or null at the filesystem root. */
  parent: string | null
  dirs: DirEntry[]
  total: number
  truncated: boolean
}

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

/**
 * GitHub-style list filters, applied server-side across ALL open PRs (not
 * just the loaded page) via GitHub's search API. All fields optional;
 * an empty filter uses the plain (updated-first) list query.
 */
export interface PrListFilter {
  /** Title text (word tokens, `in:title`); a bare hex SHA token matches by commit. */
  text?: string
  /** Author's GitHub login (exact, `author:`). */
  author?: string
  /** Head branch name (`head:`). */
  head?: string
  /** Base branch name (`base:`). */
  base?: string
  /** Draft state: true = drafts only, false = ready only, undefined = both. */
  draft?: boolean
}

/** True when no field is set — the filter that means "everything". */
export function isEmptyFilter(filter: PrListFilter): boolean {
  return (
    (filter.text ?? '') === '' &&
    (filter.author ?? '') === '' &&
    (filter.head ?? '') === '' &&
    (filter.base ?? '') === '' &&
    filter.draft === undefined
  )
}

export interface PrQueryToken {
  raw: string
  start: number
  end: number
  field?: 'author' | 'head' | 'base' | 'draft' | 'scope'
  value?: string | boolean
}

/** Shared lexical analysis keeps highlighting and applied filters in agreement. */
export function tokenizePrQuery(raw: string): PrQueryToken[] {
  return Array.from(raw.matchAll(/(?:[^\s"]|"(?:\\.|[^"\\])*"?)+/g), (match) => {
    const token: PrQueryToken = {
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }
    const qualifier = /^(author|head|base|draft|is):(.+)$/i.exec(token.raw)
    if (!qualifier) return token
    const key = qualifier[1]?.toLowerCase()
    const encoded = qualifier[2] ?? ''
    if (encoded.includes('"') && !/^"(?:\\.|[^"\\])*"$/.test(encoded)) return token
    const value = encoded.startsWith('"') ? encoded.slice(1, -1).replace(/\\(.)/g, '$1') : encoded
    if (!value.trim()) return token
    if (key === 'author' || key === 'head' || key === 'base') {
      token.field = key
      token.value = value
    } else if (key === 'draft' && /^(true|false)$/i.test(value)) {
      token.field = 'draft'
      token.value = value.toLowerCase() === 'true'
    } else if (key === 'is' && /^(draft|ready)$/i.test(value)) {
      token.field = 'draft'
      token.value = value.toLowerCase() === 'draft'
    } else if (key === 'is' && /^(open|pr)$/i.test(value)) {
      // This screen always lists open pull requests, including drafts.
      token.field = 'scope'
    }
    return token
  })
}

/** Parse supported qualifiers; unknown or incomplete tokens remain title text. */
export function parsePrQuery(raw: string): PrListFilter {
  const filter: PrListFilter = {}
  const text: string[] = []
  for (const token of tokenizePrQuery(raw)) {
    if (token.field === 'draft') filter.draft = token.value as boolean
    else if (token.field === 'author' || token.field === 'head' || token.field === 'base') {
      filter[token.field] = token.value as string
    } else if (!token.field) text.push(token.raw)
  }
  if (text.length) filter.text = text.join(' ')
  return filter
}

/**
 * The canonical display form of a filter — the same grammar `parsePrQuery`
 * consumes — so the UI can rebuild an input string from parsed parts.
 */
export function formatPrQuery(filter: PrListFilter): string {
  const parts: string[] = []
  const encode = (value: string) => (/[\s"\\]/.test(value) ? JSON.stringify(value) : value)
  if (filter.author) parts.push(`author:${encode(filter.author)}`)
  if (filter.head) parts.push(`head:${encode(filter.head)}`)
  if (filter.base) parts.push(`base:${encode(filter.base)}`)
  if (filter.draft !== undefined) parts.push(`draft:${filter.draft}`)
  if (filter.text) parts.push(filter.text)
  return parts.join(' ')
}

/** One page of a project's open PR list (GitHub-style pagination). */
export interface PullRequestPage {
  items: PullRequestSummary[]
  /** 1-based page number served. */
  page: number
  perPage: number
  /** Total open PRs in the repository. */
  total: number
  totalPages: number
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
  /** Total line count of the file at that ref — of the whole file, even when `truncated`. */
  lineCount: number
  /** Size of the whole file at that ref, in bytes. */
  size: number
  /**
   * True when `text` is incomplete: the server reads at most 5 MiB of a file, and the
   * requested text (the whole file, or the range) reached past that. `text` then ends at a
   * line boundary and holds only the leading part of what was asked for; `lineCount` and
   * `size` still describe the whole file.
   */
  truncated: boolean
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
  /** Present when the reply landed in the viewer's pending review. */
  pendingReview?: PendingReview
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

export interface ModelReasoningEffort {
  effort: string
  /** Backend-provided one-liner, e.g. "Balances speed and reasoning depth". */
  description?: string
}

export interface ModelInfo {
  /** `<provider>:<model id>`, e.g. `openai:gpt-5-mini` or `custom-deepseek:deepseek-chat`. */
  id: string
  /** `chatgpt`, or a custom provider id (`custom-<slug>`). */
  provider: string
  modelId: string
  label: string
  /** Display name of the provider, when it is not a built-in (custom providers). */
  providerLabel?: string
  /**
   * Reasoning efforts the backend catalog offers for this model, cheapest
   * first, when the provider publishes them (ChatGPT subscription only).
   */
  reasoningEfforts?: ModelReasoningEffort[]
  /** The catalog's default effort for this model. */
  defaultReasoningEffort?: string
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
  /** Requested reasoning effort; must be one of the model's `reasoningEfforts`. */
  reasoningEffort?: string
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
