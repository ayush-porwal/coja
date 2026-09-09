import { describe, expect, it } from 'vitest'
import { HttpError } from '../routes/http.js'
import type { ReviewThread } from '../shared/api.js'
import { ForgeError, type PullRequestRefs } from './forge.js'
import {
  buildConversation,
  buildSearchQuery,
  COMMENT_LOCATION_REJECTED,
  deriveMyReviewState,
  GitHubForge,
  SUMMARY_REQUIRED,
} from './github.js'
import type { GqlFn } from './graphql.js'
import * as q from './queries.js'

// ---------------------------------------------------------------------------
// Fake gql: dispatch on the operation name, record every call
// ---------------------------------------------------------------------------

type Vars = Record<string, unknown>
type Handler = (vars: Vars) => unknown

function fakeGql(handlers: Record<string, Handler>) {
  const calls: { op: string; vars: Vars }[] = []
  const gql: GqlFn = async <T>(query: string, vars: Vars = {}): Promise<T> => {
    const op = /^\s*(?:query|mutation)\s+(\w+)/m.exec(query)?.[1] ?? '?'
    calls.push({ op, vars })
    const handler = handlers[op]
    if (!handler) throw new Error(`no fake handler for operation ${op}`)
    return handler(vars) as T
  }
  const ops = () => calls.map((c) => c.op)
  const callsTo = (op: string) => calls.filter((c) => c.op === op)
  return { gql, calls, ops, callsTo }
}

const VIEWER: Handler = () => ({ viewer: { login: 'me', avatarUrl: 'https://avatars.test/me' } })
const REPO = { owner: 'acme', repo: 'widgets' }
const REFS: PullRequestRefs = {
  id: 'PR_1',
  number: 7,
  headRefOid: 'a'.repeat(40),
  baseRefOid: 'b'.repeat(40),
  baseRefName: 'main',
  headRefName: 'feature',
}

const noPage: q.PageInfo = { hasNextPage: false, endCursor: null }
const conn = <T>(
  nodes: T[],
  pageInfo: q.PageInfo = noPage,
  totalCount = nodes.length,
): q.Connection<T> => ({
  totalCount,
  pageInfo,
  nodes,
})

function rawSummary(over: Partial<q.RawPrSummary> = {}): q.RawPrSummary {
  return {
    id: 'PR_1',
    number: 7,
    title: 'Add widgets',
    url: 'https://github.com/acme/widgets/pull/7',
    isDraft: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    author: { login: 'alice', avatarUrl: 'https://avatars.test/alice' },
    headRefName: 'feature',
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    baseRefOid: 'b'.repeat(40),
    viewerReviews: { nodes: [] },
    pendingReview: { nodes: [] },
    ...over,
  }
}

function rawComment(over: Partial<q.RawReviewComment> & { id: string }): q.RawReviewComment {
  return {
    databaseId: 100,
    body: 'body',
    bodyHTML: '<p>body</p>',
    createdAt: '2026-09-02T09:00:00Z',
    url: `https://github.com/acme/widgets/pull/7#discussion_r${over.id}`,
    state: 'SUBMITTED',
    author: { login: 'bob', avatarUrl: null },
    pullRequestReview: { id: 'PRR_bob', state: 'COMMENTED' },
    ...over,
  }
}

function rawThread(over: Partial<q.RawThread> & { id: string }): q.RawThread {
  return {
    path: 'src/a.ts',
    line: 12,
    startLine: 12,
    originalLine: 10,
    diffSide: 'RIGHT',
    startDiffSide: null,
    isResolved: false,
    isOutdated: false,
    comments: conn([]),
    ...over,
  }
}

function rawReview(over: Partial<q.RawReview> & { id: string }): q.RawReview {
  return {
    state: 'COMMENTED',
    body: '',
    bodyHTML: '',
    submittedAt: '2026-09-02T08:00:00Z',
    createdAt: '2026-09-02T08:00:00Z',
    url: `https://github.com/acme/widgets/pull/7#pullrequestreview-${over.id}`,
    author: { login: 'bob' },
    comments: { totalCount: 0 },
    ...over,
  }
}

const pendingLookup =
  (node: q.RawPendingReview | null): Handler =>
  () => ({ repository: { pullRequest: { id: 'PR_1', reviews: { nodes: node ? [node] : [] } } } })

// ---------------------------------------------------------------------------

describe('deriveMyReviewState', () => {
  const r = (state: string, submittedAt: string | null) => ({ id: state, state, submittedAt })

  it('covers the whole matrix', () => {
    expect(deriveMyReviewState([], [])).toBe('none')
    expect(deriveMyReviewState(null, null)).toBe('none')
    expect(deriveMyReviewState([{ id: 'p' }], [r('APPROVED', '2026-01-01T00:00:00Z')])).toBe(
      'pending',
    )
    expect(deriveMyReviewState([], [r('APPROVED', '2026-01-01T00:00:00Z')])).toBe('approved')
    expect(deriveMyReviewState([], [r('CHANGES_REQUESTED', '2026-01-01T00:00:00Z')])).toBe(
      'changes_requested',
    )
    expect(deriveMyReviewState([], [r('COMMENTED', '2026-01-01T00:00:00Z')])).toBe('commented')
    expect(deriveMyReviewState([], [r('DISMISSED', '2026-01-01T00:00:00Z')])).toBe('commented')
    // A stray PENDING entry without the pending lookup is ignored.
    expect(deriveMyReviewState([], [r('PENDING', null)])).toBe('none')
  })

  it('picks the latest submitted review, regardless of order', () => {
    expect(
      deriveMyReviewState(
        [],
        [
          r('APPROVED', '2026-01-03T00:00:00Z'),
          r('CHANGES_REQUESTED', '2026-01-01T00:00:00Z'),
          r('COMMENTED', '2026-01-02T00:00:00Z'),
        ],
      ),
    ).toBe('approved')
    expect(
      deriveMyReviewState(
        [],
        [
          r('APPROVED', '2026-01-01T00:00:00Z'),
          r('CHANGES_REQUESTED', '2026-01-02T00:00:00Z'),
          null,
        ],
      ),
    ).toBe('changes_requested')
  })

  it('keeps the standing opinion when a later COMMENTED review exists (GitHub rule)', () => {
    // A published thread reply creates a COMMENTED review; it must not hide "changes requested".
    expect(
      deriveMyReviewState(
        [],
        [r('CHANGES_REQUESTED', '2026-01-01T00:00:00Z'), r('COMMENTED', '2026-01-02T00:00:00Z')],
      ),
    ).toBe('changes_requested')
    expect(
      deriveMyReviewState(
        [],
        [r('APPROVED', '2026-01-01T00:00:00Z'), r('COMMENTED', '2026-01-02T00:00:00Z')],
      ),
    ).toBe('approved')
  })
})

describe('GitHubForge.viewer / listOpenPullRequests', () => {
  it('fetches the viewer once and maps the PR list with review states', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrList: () => ({
        repository: {
          pullRequests: conn([
            rawSummary({ id: 'PR_1', number: 1 }),
            rawSummary({
              id: 'PR_2',
              number: 2,
              author: null,
              pendingReview: { nodes: [{ id: 'PRR_p', comments: { totalCount: 2 } }] },
            }),
            rawSummary({
              id: 'PR_3',
              number: 3,
              viewerReviews: {
                nodes: [
                  { id: 'x', state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z' },
                ],
              },
            }),
          ]),
        },
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.viewer()).resolves.toEqual({
      login: 'me',
      avatarUrl: 'https://avatars.test/me',
    })
    const page1 = await forge.listPullRequestPage(REPO, 1)
    await forge.viewer()
    expect(fake.callsTo('Viewer')).toHaveLength(1)
    expect(fake.callsTo('PrList')[0]?.vars).toEqual({ owner: 'acme', name: 'widgets', login: 'me' })
    expect(page1).toMatchObject({ page: 1, perPage: 100, total: 3, totalPages: 1 })

    expect(page1.items.map((p) => [p.number, p.myReviewState])).toEqual([
      [1, 'none'],
      [2, 'pending'],
      [3, 'changes_requested'],
    ])
    expect(page1.items[0]).toMatchObject({
      id: 'PR_1',
      title: 'Add widgets',
      author: { login: 'alice', avatarUrl: 'https://avatars.test/alice' },
      headRefName: 'feature',
      baseRefName: 'main',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      isDraft: false,
    })
    expect(page1.items[1]?.author).toEqual({ login: 'ghost' })
  })

  it('serves numbered pages via cursors, walks jumps, and reuses cached cursors', async () => {
    // 250 PRs => 3 pages of 100; the fake honours `after` like GitHub does.
    const all = Array.from({ length: 250 }, (_, i) =>
      rawSummary({ id: `PR_${i + 1}`, number: i + 1 }),
    )
    const served: (string | undefined)[] = []
    const fake = fakeGql({
      Viewer: VIEWER,
      PrList: (vars) => {
        served.push(vars.after as string | undefined)
        const start = vars.after === undefined ? 0 : Number(vars.after) * 100
        const nodes = all.slice(start, start + 100)
        const pageNumber = start / 100
        return {
          repository: {
            pullRequests: conn(
              nodes,
              {
                hasNextPage: pageNumber < 2,
                endCursor: pageNumber < 2 ? String(pageNumber + 1) : null,
              },
              250,
            ),
          },
        }
      },
    })
    const forge = new GitHubForge({ gql: fake.gql })

    const page1 = await forge.listPullRequestPage(REPO, 1)
    expect(page1.items.map((p) => p.number)).toEqual(all.slice(0, 100).map((p) => p.number))
    expect(page1).toMatchObject({ page: 1, perPage: 100, total: 250, totalPages: 3 })
    expect(served).toEqual([undefined])

    // Jump to page 3: walks page 2 (cursor cached) then serves page 3.
    const page3 = await forge.listPullRequestPage(REPO, 3)
    expect(page3.items.map((p) => p.number)).toEqual(all.slice(200).map((p) => p.number))
    expect(served).toEqual([undefined, '1', '2'])

    // Page 2 is cached: one query, `after` = page 2's start cursor.
    const page2 = await forge.listPullRequestPage(REPO, 2)
    expect(page2.items.map((p) => p.number)).toEqual(all.slice(100, 200).map((p) => p.number))
    expect(served).toEqual([undefined, '1', '2', '1'])
  })

  it('answers an out-of-range page as empty with correct totals', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrList: () => ({
        repository: { pullRequests: conn([rawSummary({ number: 1 })], noPage, 1) },
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const beyond = await forge.listPullRequestPage(REPO, 5)
    expect(beyond).toMatchObject({ page: 5, items: [], total: 1, totalPages: 1 })
    // Page 0/negative clamps to 1.
    const clamped = await forge.listPullRequestPage(REPO, 0)
    expect(clamped.page).toBe(1)
  })

  it('does not cache a failed viewer lookup', async () => {
    let fail = true
    const fake = fakeGql({
      Viewer: () => {
        if (fail) throw new ForgeError('boom', 502)
        return { viewer: { login: 'me', avatarUrl: null } }
      },
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.viewer()).rejects.toBeInstanceOf(ForgeError)
    fail = false
    await expect(forge.viewer()).resolves.toEqual({ login: 'me' })
  })
})

describe('GitHubForge.getPullRequestRefs', () => {
  it('returns the refs and 404s on a missing PR', async () => {
    const fake = fakeGql({
      PrRefs: (vars) => ({
        repository: {
          pullRequest:
            vars.number === 7
              ? {
                  id: 'PR_1',
                  number: 7,
                  headRefOid: REFS.headRefOid,
                  baseRefOid: REFS.baseRefOid,
                  baseRefName: 'main',
                  headRefName: 'feature',
                }
              : null,
        },
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.getPullRequestRefs(REPO, 7)).resolves.toEqual(REFS)
    await expect(forge.getPullRequestRefs(REPO, 8)).rejects.toMatchObject({ status: 404 })
  })
})

describe('GitHubForge.getPullRequest', () => {
  const T = {
    ic1: '2026-09-02T07:00:00Z',
    rev: '2026-09-02T08:00:00Z',
    ic2: '2026-09-02T09:00:00Z',
    approve: '2026-09-02T10:00:00Z',
  }

  const detail = (): q.RawPrDetail => ({
    ...rawSummary({
      pendingReview: { nodes: [{ id: 'PRR_pending', comments: { totalCount: 1 } }] },
      viewerReviews: {
        nodes: [
          { id: 'PRR_mine', state: 'COMMENTED', submittedAt: '2026-09-01T00:00:00Z' },
          { id: 'PRR_pending', state: 'PENDING', submittedAt: null },
        ],
      },
    }),
    body: 'Adds widgets.',
    bodyHTML: '<p>Adds widgets.</p>',
    commits: conn([
      {
        url: 'https://github.com/acme/widgets/pull/7/commits/aaa',
        commit: {
          oid: 'a'.repeat(40),
          abbreviatedOid: 'aaaaaaa',
          messageHeadline: 'Add widgets',
          messageBody: 'Details.',
          committedDate: '2026-09-01T09:00:00Z',
          url: 'https://github.com/acme/widgets/commit/aaa',
          author: { name: 'Alice', user: { login: 'alice' } },
        },
      },
      {
        url: '',
        commit: {
          oid: 'c'.repeat(40),
          abbreviatedOid: 'ccccccc',
          messageHeadline: 'Fixup',
          messageBody: '',
          committedDate: '2026-09-01T09:30:00Z',
          url: 'https://github.com/acme/widgets/commit/ccc',
          author: { name: 'Nobody', user: null },
        },
      },
    ]),
    files: conn([
      {
        path: 'src/a.ts',
        additions: 5,
        deletions: 1,
        changeType: 'MODIFIED',
        viewerViewedState: 'VIEWED',
      },
      {
        path: 'src/b.ts',
        additions: 5,
        deletions: 0,
        changeType: 'ADDED',
        viewerViewedState: 'UNVIEWED',
      },
      {
        path: 'src/new.ts',
        additions: 0,
        deletions: 1,
        changeType: 'RENAMED',
        viewerViewedState: 'DISMISSED',
      },
    ]),
    reviewThreads: conn([
      rawThread({
        id: 'PRRT_live',
        comments: conn([
          rawComment({
            id: 'PRRC_1',
            author: { login: 'bob' },
            pullRequestReview: { id: 'PRR_bob', state: 'CHANGES_REQUESTED' },
          }),
          rawComment({
            id: 'PRRC_2',
            author: { login: 'me' },
            databaseId: null,
            url: null,
            pullRequestReview: { id: 'PRR_mine', state: 'COMMENTED' },
          }),
        ]),
      }),
      rawThread({
        id: 'PRRT_outdated',
        path: 'src/b.ts',
        line: null,
        startLine: null,
        originalLine: 5,
        isOutdated: true,
        isResolved: true,
        comments: conn([rawComment({ id: 'PRRC_3', author: { login: 'bob' } })]),
      }),
      rawThread({
        id: 'PRRT_pending',
        path: 'src/a.ts',
        line: 30,
        startLine: 28,
        diffSide: 'RIGHT',
        startDiffSide: 'LEFT',
        originalLine: 30,
        comments: conn([
          rawComment({
            id: 'PRRC_4',
            state: 'PENDING',
            author: { login: 'me' },
            pullRequestReview: { id: 'PRR_pending', state: 'PENDING' },
          }),
        ]),
      }),
    ]),
    reviews: conn([
      rawReview({
        id: 'PRR_pending',
        state: 'PENDING',
        author: { login: 'me' },
        submittedAt: null,
        body: 'draft',
      }),
      rawReview({ id: 'PRR_noise', state: 'COMMENTED', body: '', comments: { totalCount: 0 } }),
      rawReview({
        id: 'PRR_bob',
        state: 'CHANGES_REQUESTED',
        body: 'Please fix',
        bodyHTML: '<p>Please fix</p>',
        submittedAt: T.rev,
        comments: { totalCount: 1 },
      }),
      rawReview({
        id: 'PRR_lgtm',
        state: 'APPROVED',
        author: { login: 'carol' },
        body: '',
        submittedAt: T.approve,
        comments: { totalCount: 0 },
      }),
    ]),
    comments: conn([
      {
        id: 'IC_2',
        body: 'second',
        bodyHTML: '<p>second</p>',
        createdAt: T.ic2,
        url: 'u2',
        author: { login: 'alice' },
      },
      {
        id: 'IC_1',
        body: 'first',
        bodyHTML: '<p>first</p>',
        createdAt: T.ic1,
        url: null,
        author: null,
      },
    ]),
  })

  it('maps the whole detail', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrDetail: () => ({ repository: { pullRequest: detail() } }),
    })
    const pr = await new GitHubForge({ gql: fake.gql }).getPullRequest(REPO, 7)

    expect(fake.ops()).toEqual(['Viewer', 'PrDetail'])
    expect(fake.callsTo('PrDetail')[0]?.vars).toEqual({
      owner: 'acme',
      name: 'widgets',
      number: 7,
      login: 'me',
    })

    expect(pr).toMatchObject({
      id: 'PR_1',
      number: 7,
      body: 'Adds widgets.',
      bodyHTML: '<p>Adds widgets.</p>',
      myReviewState: 'pending',
      pendingReview: { id: 'PRR_pending', commentCount: 1 },
      viewer: { login: 'me', avatarUrl: 'https://avatars.test/me' },
    })

    expect(pr.commits).toEqual([
      {
        oid: 'a'.repeat(40),
        abbreviatedOid: 'aaaaaaa',
        messageHeadline: 'Add widgets',
        messageBody: 'Details.',
        authorName: 'Alice',
        authorLogin: 'alice',
        committedDate: '2026-09-01T09:00:00Z',
        url: 'https://github.com/acme/widgets/pull/7/commits/aaa',
      },
      {
        oid: 'c'.repeat(40),
        abbreviatedOid: 'ccccccc',
        messageHeadline: 'Fixup',
        messageBody: '',
        authorName: 'Nobody',
        committedDate: '2026-09-01T09:30:00Z',
        url: 'https://github.com/acme/widgets/commit/ccc',
      },
    ])

    expect(pr.files).toEqual([
      {
        path: 'src/a.ts',
        additions: 5,
        deletions: 1,
        changeType: 'MODIFIED',
        viewedState: 'VIEWED',
      },
      {
        path: 'src/b.ts',
        additions: 5,
        deletions: 0,
        changeType: 'ADDED',
        viewedState: 'UNVIEWED',
      },
      {
        path: 'src/new.ts',
        additions: 0,
        deletions: 1,
        changeType: 'RENAMED',
        viewedState: 'DISMISSED',
      },
    ])

    const byId = Object.fromEntries(pr.threads.map((t) => [t.id, t])) as Record<
      string,
      ReviewThread
    >
    expect(byId.PRRT_live).toMatchObject({
      path: 'src/a.ts',
      line: 12,
      startLine: 12,
      side: 'RIGHT',
      startSide: null,
      originalLine: 10,
      isResolved: false,
      isOutdated: false,
    })
    expect(byId.PRRT_live?.comments).toEqual([
      {
        id: 'PRRC_1',
        databaseId: 100,
        body: 'body',
        bodyHTML: '<p>body</p>',
        author: { login: 'bob' },
        createdAt: '2026-09-02T09:00:00Z',
        url: 'https://github.com/acme/widgets/pull/7#discussion_rPRRC_1',
        reviewId: 'PRR_bob',
        reviewState: 'CHANGES_REQUESTED',
        isPending: false,
        isMine: false,
      },
      {
        id: 'PRRC_2',
        body: 'body',
        bodyHTML: '<p>body</p>',
        author: { login: 'me' },
        createdAt: '2026-09-02T09:00:00Z',
        reviewId: 'PRR_mine',
        reviewState: 'COMMENTED',
        isPending: false,
        isMine: true,
      },
    ])
    expect(byId.PRRT_outdated).toMatchObject({
      line: null,
      startLine: null,
      originalLine: 5,
      isOutdated: true,
      isResolved: true,
    })
    expect(byId.PRRT_pending).toMatchObject({
      line: 30,
      startLine: 28,
      side: 'RIGHT',
      startSide: 'LEFT',
    })
    expect(byId.PRRT_pending?.comments[0]).toMatchObject({
      isPending: true,
      isMine: true,
      reviewId: 'PRR_pending',
      reviewState: 'PENDING',
    })

    // Conversation: pending review and body-less comment-less COMMENTED review dropped; ascending by time.
    expect(pr.conversation.map((c) => [c.kind, c.id])).toEqual([
      ['comment', 'IC_1'],
      ['review', 'PRR_bob'],
      ['comment', 'IC_2'],
      ['review', 'PRR_lgtm'],
    ])
    expect(pr.conversation[0]).toEqual({
      kind: 'comment',
      id: 'IC_1',
      author: { login: 'ghost' },
      body: 'first',
      bodyHTML: '<p>first</p>',
      createdAt: T.ic1,
    })
    expect(pr.conversation[1]).toMatchObject({
      kind: 'review',
      state: 'CHANGES_REQUESTED',
      submittedAt: T.rev,
      commentCount: 1,
      body: 'Please fix',
    })
    expect(pr.conversation[3]).toMatchObject({ kind: 'review', state: 'APPROVED', commentCount: 0 })
  })

  it('pages files, threads, commits and long thread comments', async () => {
    const base = detail()
    base.files = conn(base.files.nodes as q.RawFile[], { hasNextPage: true, endCursor: 'f1' })
    base.reviewThreads = conn(
      [
        rawThread({
          id: 'PRRT_long',
          comments: conn([rawComment({ id: 'PRRC_a' })], { hasNextPage: true, endCursor: 'cc1' }),
        }),
      ],
      { hasNextPage: true, endCursor: 't1' },
    )
    base.commits = conn(base.commits.nodes as q.RawCommit[], { hasNextPage: true, endCursor: 'k1' })

    const fake = fakeGql({
      Viewer: VIEWER,
      PrDetail: () => ({ repository: { pullRequest: base } }),
      PrFilesPage: (vars) => ({
        repository: {
          pullRequest: {
            files:
              vars.after === 'f1'
                ? conn(
                    [
                      {
                        path: 'p2.ts',
                        additions: 1,
                        deletions: 1,
                        changeType: 'MODIFIED',
                        viewerViewedState: 'UNVIEWED',
                      },
                    ],
                    { hasNextPage: true, endCursor: 'f2' },
                  )
                : conn([
                    {
                      path: 'p3.ts',
                      additions: 1,
                      deletions: 1,
                      changeType: 'DELETED',
                      viewerViewedState: 'UNVIEWED',
                    },
                  ]),
          },
        },
      }),
      PrThreadsPage: () => ({
        repository: {
          pullRequest: {
            reviewThreads: conn([
              rawThread({ id: 'PRRT_page2', comments: conn([rawComment({ id: 'PRRC_z' })]) }),
            ]),
          },
        },
      }),
      PrCommitsPage: () => ({
        repository: {
          pullRequest: {
            commits: conn([
              {
                url: 'u',
                commit: {
                  oid: 'd'.repeat(40),
                  abbreviatedOid: 'ddddddd',
                  messageHeadline: 'More',
                  messageBody: '',
                  committedDate: '2026-09-01T10:00:00Z',
                  url: 'u',
                  author: null,
                },
              },
            ]),
          },
        },
      }),
      ThreadCommentsPage: (vars) => ({
        node: { comments: conn([rawComment({ id: `PRRC_more_${String(vars.after)}` })]) },
      }),
    })

    const pr = await new GitHubForge({ gql: fake.gql }).getPullRequest(REPO, 7)
    expect(pr.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/new.ts',
      'p2.ts',
      'p3.ts',
    ])
    expect(fake.callsTo('PrFilesPage').map((c) => c.vars.after)).toEqual(['f1', 'f2'])
    expect(fake.callsTo('PrFilesPage')[0]?.vars).toMatchObject({
      owner: 'acme',
      name: 'widgets',
      number: 7,
    })

    expect(pr.threads.map((t) => t.id)).toEqual(['PRRT_long', 'PRRT_page2'])
    expect(pr.threads[0]?.comments.map((c) => c.id)).toEqual(['PRRC_a', 'PRRC_more_cc1'])
    expect(fake.callsTo('ThreadCommentsPage')[0]?.vars).toEqual({ id: 'PRRT_long', after: 'cc1' })

    expect(pr.commits.map((c) => c.abbreviatedOid)).toEqual(['aaaaaaa', 'ccccccc', 'ddddddd'])
    expect(pr.commits[2]?.authorName).toBe('unknown')
  })

  it('404s when the PR does not exist', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrDetail: () => ({ repository: { pullRequest: null } }),
    })
    await expect(new GitHubForge({ gql: fake.gql }).getPullRequest(REPO, 99)).rejects.toMatchObject(
      {
        status: 404,
      },
    )
  })
})

describe('buildConversation', () => {
  it('keeps body-less approvals and drops body-less empty comment reviews', () => {
    const items = buildConversation(
      [],
      [
        rawReview({ id: 'a', state: 'APPROVED', body: '' }),
        rawReview({ id: 'b', state: 'COMMENTED', body: '' }),
        rawReview({ id: 'c', state: 'COMMENTED', body: '', comments: { totalCount: 2 } }),
        rawReview({ id: 'd', state: 'COMMENTED', body: '   ' }),
        rawReview({ id: 'e', state: 'PENDING', body: 'draft', submittedAt: null }),
      ],
    )
    expect(items.map((i) => i.id)).toEqual(['a', 'c'])
  })
})

describe('GitHubForge.addPendingComment', () => {
  const addedThread = (reviewId: string, totalCount: number | null) => ({
    addPullRequestReviewThread: {
      thread: {
        ...rawThread({
          id: 'PRRT_new',
          path: 'src/audit.ts',
          line: 5,
          startLine: 5,
          originalLine: 5,
          comments: conn([
            rawComment({
              id: 'PRRC_new',
              body: 'nit',
              state: 'PENDING',
              author: { login: 'me' },
              pullRequestReview: { id: reviewId, state: 'PENDING' },
            }),
          ]),
        }),
        firstComment: {
          nodes: [
            {
              pullRequestReview: {
                id: reviewId,
                comments: totalCount === null ? null : { totalCount },
              },
            },
          ],
        },
      },
    },
  })

  it('creates the pending review when none exists, then adds the thread', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup(null),
      StartReview: () => ({
        addPullRequestReview: { pullRequestReview: { id: 'PRR_new', state: 'PENDING' } },
      }),
      AddThread: () => addedThread('PRR_new', 1),
    })
    const res = await new GitHubForge({ gql: fake.gql }).addPendingComment(REPO, REFS, {
      path: 'src/audit.ts',
      body: 'nit',
      line: 5,
      side: 'RIGHT',
    })

    expect(fake.ops()).toEqual(['Viewer', 'PendingReview', 'StartReview', 'AddThread'])
    expect(fake.callsTo('PendingReview')[0]?.vars).toEqual({
      owner: 'acme',
      name: 'widgets',
      number: 7,
      login: 'me',
    })
    expect(fake.callsTo('StartReview')[0]?.vars).toEqual({
      pullRequestId: 'PR_1',
      commitOID: REFS.headRefOid,
    })
    expect(fake.callsTo('AddThread')[0]?.vars).toEqual({
      input: {
        pullRequestReviewId: 'PRR_new',
        path: 'src/audit.ts',
        body: 'nit',
        line: 5,
        side: 'RIGHT',
      },
    })

    expect(res.pendingReview).toEqual({ id: 'PRR_new', commentCount: 1 })
    expect(res.thread).toMatchObject({
      id: 'PRRT_new',
      path: 'src/audit.ts',
      line: 5,
      side: 'RIGHT',
    })
    expect(res.thread.comments).toHaveLength(1)
    expect(res.thread.comments[0]).toMatchObject({
      id: 'PRRC_new',
      body: 'nit',
      isPending: true,
      isMine: true,
      reviewId: 'PRR_new',
      reviewState: 'PENDING',
    })
  })

  it('reuses an existing pending review and sends a range only when it differs from the line', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_old', comments: { totalCount: 3 } }),
      AddThread: () => addedThread('PRR_old', null),
    })
    const forge = new GitHubForge({ gql: fake.gql })

    const res = await forge.addPendingComment(REPO, REFS, {
      path: 'src/audit.ts',
      body: 'range',
      line: 9,
      side: 'RIGHT',
      startLine: 5,
    })
    expect(fake.ops()).not.toContain('StartReview')
    expect(fake.callsTo('AddThread')[0]?.vars).toEqual({
      input: {
        pullRequestReviewId: 'PRR_old',
        path: 'src/audit.ts',
        body: 'range',
        line: 9,
        side: 'RIGHT',
        startLine: 5,
        startSide: 'RIGHT',
      },
    })
    // No count in the payload → previous count + 1.
    expect(res.pendingReview).toEqual({ id: 'PRR_old', commentCount: 4 })

    await forge.addPendingComment(REPO, REFS, {
      path: 'src/audit.ts',
      body: 'single',
      line: 9,
      side: 'LEFT',
      startLine: 9,
      startSide: 'LEFT',
    })
    const input = fake.callsTo('AddThread')[1]?.vars.input as Record<string, unknown>
    expect(input).not.toHaveProperty('startLine')
    expect(input).not.toHaveProperty('startSide')
    expect(input.side).toBe('LEFT')
  })

  it('sends the range when only the side differs (same line number across the diff)', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_old', comments: { totalCount: 0 } }),
      AddThread: () => addedThread('PRR_old', 1),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await forge.addPendingComment(REPO, REFS, {
      path: 'src/audit.ts',
      body: 'both sides',
      line: 9,
      side: 'RIGHT',
      startLine: 9,
      startSide: 'LEFT',
    })
    expect(fake.callsTo('AddThread')[0]?.vars.input).toMatchObject({
      line: 9,
      side: 'RIGHT',
      startLine: 9,
      startSide: 'LEFT',
    })
    // startSide alone implies startLine = line on the other side.
    await forge.addPendingComment(REPO, REFS, {
      path: 'src/audit.ts',
      body: 'implicit start',
      line: 4,
      side: 'RIGHT',
      startSide: 'LEFT',
    })
    expect(fake.callsTo('AddThread')[1]?.vars.input).toMatchObject({
      line: 4,
      side: 'RIGHT',
      startLine: 4,
      startSide: 'LEFT',
    })
  })

  it('serializes comments per PR so two quick first comments share one pending review', async () => {
    let created: q.RawPendingReview | null = null
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: (vars) => pendingLookup(created)(vars),
      StartReview: () => {
        created = { id: 'PRR_new', comments: { totalCount: 0 } }
        return { addPullRequestReview: { pullRequestReview: { id: 'PRR_new', state: 'PENDING' } } }
      },
      AddThread: () => addedThread('PRR_new', 1),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const input = { path: 'src/audit.ts', body: 'nit', line: 5, side: 'RIGHT' as const }
    const [first, second] = await Promise.all([
      forge.addPendingComment(REPO, REFS, input),
      forge.addPendingComment(REPO, REFS, { ...input, line: 6 }),
    ])
    expect(fake.ops()).toEqual([
      'Viewer',
      'PendingReview',
      'StartReview',
      'AddThread',
      'PendingReview',
      'AddThread',
    ])
    expect(first.pendingReview.id).toBe('PRR_new')
    expect(second.pendingReview.id).toBe('PRR_new')
  })

  it('does not let a failed comment block the ones queued behind it, and does not serialize across PRs', async () => {
    let threads = 0
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_old', comments: { totalCount: 0 } }),
      AddThread: () =>
        threads++ === 0
          ? { addPullRequestReviewThread: { thread: null } }
          : addedThread('PRR_old', 1),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const input = { path: 'x', body: 'y', line: 1, side: 'RIGHT' as const }
    const [failed, ok] = await Promise.allSettled([
      forge.addPendingComment(REPO, REFS, input),
      forge.addPendingComment(REPO, REFS, input),
    ])
    expect(failed.status).toBe('rejected')
    expect(ok.status).toBe('fulfilled')

    // Different PRs run concurrently: both lookups happen before either thread is added.
    const other = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_old', comments: { totalCount: 0 } }),
      AddThread: () => addedThread('PRR_old', 1),
    })
    const concurrent = new GitHubForge({ gql: other.gql })
    await Promise.all([
      concurrent.addPendingComment(REPO, REFS, input),
      concurrent.addPendingComment(REPO, { ...REFS, number: 8 }, input),
    ])
    expect(other.ops().slice(0, 3)).toEqual(['Viewer', 'PendingReview', 'PendingReview'])
  })

  it('explains a null thread (line outside the diff) as a 422', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_old', comments: { totalCount: 0 } }),
      AddThread: () => ({ addPullRequestReviewThread: { thread: null } }),
    })
    const err = await new GitHubForge({ gql: fake.gql })
      .addPendingComment(REPO, REFS, { path: 'x', body: 'y', line: 999, side: 'RIGHT' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForgeError)
    expect(err).toMatchObject({ status: 422, message: COMMENT_LOCATION_REJECTED })
  })
})

describe('GitHubForge comment / reply / viewed mutations', () => {
  it('replies without a pending review id and marks the reply as mine', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      Reply: () => ({
        addPullRequestReviewThreadReply: {
          comment: rawComment({ id: 'PRRC_r', author: { login: 'me' }, pullRequestReview: null }),
        },
      }),
    })
    const res = await new GitHubForge({ gql: fake.gql }).replyToThread('PRRT_x', 'thanks')
    expect(fake.callsTo('Reply')[0]?.vars).toEqual({ threadId: 'PRRT_x', body: 'thanks' })
    expect(res.threadId).toBe('PRRT_x')
    expect(res.comment).toMatchObject({ id: 'PRRC_r', isMine: true, isPending: false })
    expect(res.comment).not.toHaveProperty('reviewId')
    expect(res).not.toHaveProperty('pendingReview')
  })

  it('reports the pending review a reply landed in', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      Reply: () => ({
        addPullRequestReviewThreadReply: {
          comment: {
            ...rawComment({ id: 'PRRC_r', state: 'PENDING', author: { login: 'me' } }),
            pullRequestReview: { id: 'PRR_p', state: 'PENDING', comments: { totalCount: 3 } },
          },
        },
      }),
    })
    const res = await new GitHubForge({ gql: fake.gql }).replyToThread('PRRT_x', 'thanks')
    expect(res.comment).toMatchObject({
      isPending: true,
      reviewId: 'PRR_p',
      reviewState: 'PENDING',
    })
    expect(res.pendingReview).toEqual({ id: 'PRR_p', commentCount: 3 })

    // A published reply belongs to a submitted review: no pendingReview.
    const published = fakeGql({
      Viewer: VIEWER,
      Reply: () => ({
        addPullRequestReviewThreadReply: {
          comment: {
            ...rawComment({ id: 'PRRC_s', author: { login: 'me' } }),
            pullRequestReview: { id: 'PRR_c', state: 'COMMENTED', comments: { totalCount: 1 } },
          },
        },
      }),
    })
    const pub = await new GitHubForge({ gql: published.gql }).replyToThread('PRRT_x', 'ok')
    expect(pub.comment.isPending).toBe(false)
    expect(pub).not.toHaveProperty('pendingReview')
  })

  it('updates and deletes comments', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      UpdateComment: (vars) => ({
        updatePullRequestReviewComment: {
          pullRequestReviewComment: rawComment({
            id: String(vars.id),
            body: String(vars.body),
            author: { login: 'me' },
          }),
        },
      }),
      DeleteComment: () => ({
        deletePullRequestReviewComment: { pullRequestReviewComment: { id: 'PRRC_1' } },
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.updateComment('PRRC_1', 'edited')).resolves.toMatchObject({
      id: 'PRRC_1',
      body: 'edited',
      isMine: true,
    })
    await forge.deleteComment('PRRC_1')
    expect(fake.callsTo('DeleteComment')[0]?.vars).toEqual({ id: 'PRRC_1' })
  })

  it('marks and unmarks files as viewed', async () => {
    const fake = fakeGql({
      MarkViewed: () => ({ markFileAsViewed: { pullRequest: { id: 'PR_1' } } }),
      UnmarkViewed: () => ({ unmarkFileAsViewed: { pullRequest: { id: 'PR_1' } } }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.setFileViewed('PR_1', 'src/a.ts', true)).resolves.toBe('VIEWED')
    await expect(forge.setFileViewed('PR_1', 'src/a.ts', false)).resolves.toBe('UNVIEWED')
    expect(fake.calls).toEqual([
      { op: 'MarkViewed', vars: { pullRequestId: 'PR_1', path: 'src/a.ts' } },
      { op: 'UnmarkViewed', vars: { pullRequestId: 'PR_1', path: 'src/a.ts' } },
    ])
  })
})

describe('GitHubForge.assertCommentInPullRequest / assertThreadInPullRequest', () => {
  const owner = (number: number, login = 'acme', name = 'widgets') => ({
    node: { pullRequest: { number, repository: { name, owner: { login } } } },
  })
  const rejection = (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: unknown) => e,
    )

  it('passes when the node belongs to the PR, comparing slugs case-insensitively', async () => {
    const fake = fakeGql({
      CommentOwner: () => owner(7, 'Acme', 'Widgets'),
      ThreadOwner: () => owner(7),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await expect(forge.assertCommentInPullRequest('PRRC_1', REPO, 7)).resolves.toBeUndefined()
    await expect(forge.assertThreadInPullRequest('PRRT_1', REPO, 7)).resolves.toBeUndefined()
    expect(fake.calls).toEqual([
      { op: 'CommentOwner', vars: { id: 'PRRC_1' } },
      { op: 'ThreadOwner', vars: { id: 'PRRT_1' } },
    ])
    // The documents pin the node type, so a thread id never resolves through the comment check.
    expect(q.COMMENT_OWNER).toContain('... on PullRequestReviewComment')
    expect(q.COMMENT_OWNER).not.toContain('PullRequestReviewThread')
    expect(q.THREAD_OWNER).toContain('... on PullRequestReviewThread')
  })

  it('404s for another PR, another repository, an unknown node or a node of the wrong type', async () => {
    const answers: Record<string, unknown> = {
      otherPr: owner(8),
      otherRepo: owner(7, 'someone-else'),
      otherName: owner(7, 'acme', 'gadgets'),
      unknown: { node: null },
      wrongType: { node: {} },
    }
    const fake = fakeGql({
      CommentOwner: (vars) => answers[String(vars.id)],
      ThreadOwner: (vars) => answers[String(vars.id)],
    })
    const forge = new GitHubForge({ gql: fake.gql })
    for (const id of Object.keys(answers)) {
      const err = await rejection(forge.assertCommentInPullRequest(id, REPO, 7))
      expect(err, id).toBeInstanceOf(HttpError)
      expect(err).toMatchObject({
        status: 404,
        code: 'not_found',
        message: 'comment not found in this pull request',
      })
      const threadErr = await rejection(forge.assertThreadInPullRequest(id, REPO, 7))
      expect(threadErr).toMatchObject({
        status: 404,
        message: 'thread not found in this pull request',
      })
    }
  })

  it("folds GitHub's own NOT_FOUND into the same 404 but propagates other failures", async () => {
    const fake = fakeGql({
      CommentOwner: (vars) => {
        if (vars.id === 'garbage') throw new ForgeError('Could not resolve to a node', 404)
        throw new ForgeError('rate limited', 429)
      },
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const notFound = await rejection(forge.assertCommentInPullRequest('garbage', REPO, 7))
    expect(notFound).toBeInstanceOf(HttpError)
    expect(notFound).toMatchObject({ status: 404, code: 'not_found' })
    const limited = await rejection(forge.assertCommentInPullRequest('PRRC_1', REPO, 7))
    expect(limited).toBeInstanceOf(ForgeError)
    expect(limited).toMatchObject({ status: 429 })
  })
})

describe('GitHubForge.submitReview', () => {
  const submitted = (id: string, state: string) => ({
    pullRequestReview: {
      id,
      state,
      url: `https://github.com/acme/widgets/pull/7#pullrequestreview-${id}`,
    },
  })

  it('submits the pending review, omitting a blank body', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_p', comments: { totalCount: 2 } }),
      SubmitReview: () => ({ submitPullRequestReview: submitted('PRR_p', 'COMMENTED') }),
    })
    const res = await new GitHubForge({ gql: fake.gql }).submitReview(REPO, REFS, {
      event: 'COMMENT',
      body: '  ',
    })
    expect(fake.callsTo('SubmitReview')[0]?.vars).toEqual({ reviewId: 'PRR_p', event: 'COMMENT' })
    expect(fake.ops()).not.toContain('AddAndSubmitReview')
    expect(res).toEqual({
      reviewId: 'PRR_p',
      state: 'COMMENTED',
      url: 'https://github.com/acme/widgets/pull/7#pullrequestreview-PRR_p',
    })
  })

  it('submits with the body when given', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_p', comments: { totalCount: 0 } }),
      SubmitReview: () => ({ submitPullRequestReview: submitted('PRR_p', 'CHANGES_REQUESTED') }),
    })
    const res = await new GitHubForge({ gql: fake.gql }).submitReview(REPO, REFS, {
      event: 'REQUEST_CHANGES',
      body: 'Please fix',
    })
    expect(fake.callsTo('SubmitReview')[0]?.vars).toEqual({
      reviewId: 'PRR_p',
      event: 'REQUEST_CHANGES',
      body: 'Please fix',
    })
    expect(res.state).toBe('CHANGES_REQUESTED')
  })

  it('creates and submits in one call when there is no pending review', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup(null),
      AddAndSubmitReview: () => ({ addPullRequestReview: submitted('PRR_new', 'APPROVED') }),
    })
    const res = await new GitHubForge({ gql: fake.gql }).submitReview(REPO, REFS, {
      event: 'APPROVE',
      body: '',
    })
    expect(fake.callsTo('AddAndSubmitReview')[0]?.vars).toEqual({
      pullRequestId: 'PR_1',
      commitOID: REFS.headRefOid,
      event: 'APPROVE',
    })
    expect(res).toMatchObject({ reviewId: 'PRR_new', state: 'APPROVED' })
  })

  it('refuses a body-less COMMENT / REQUEST_CHANGES with nothing to say, before touching GitHub', async () => {
    const noPending = fakeGql({ Viewer: VIEWER, PendingReview: pendingLookup(null) })
    const forge = new GitHubForge({ gql: noPending.gql })
    for (const event of ['COMMENT', 'REQUEST_CHANGES'] as const) {
      const err = await forge
        .submitReview(REPO, REFS, { event, body: ' \n' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpError)
      expect(err).toMatchObject({ status: 400, code: 'bad_request', message: SUMMARY_REQUIRED })
    }
    expect(noPending.ops().filter((op) => op.endsWith('Review') && op !== 'PendingReview')).toEqual(
      [],
    )

    // A pending review without comments does not count as "something to say" either.
    const emptyPending = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_p', comments: { totalCount: 0 } }),
    })
    await expect(
      new GitHubForge({ gql: emptyPending.gql }).submitReview(REPO, REFS, {
        event: 'COMMENT',
        body: '',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('GitHubForge.discardPendingReview', () => {
  it('deletes the pending review when present and is a no-op otherwise', async () => {
    const withPending = fakeGql({
      Viewer: VIEWER,
      PendingReview: pendingLookup({ id: 'PRR_p', comments: { totalCount: 1 } }),
      DiscardReview: () => ({ deletePullRequestReview: { pullRequestReview: { id: 'PRR_p' } } }),
    })
    await new GitHubForge({ gql: withPending.gql }).discardPendingReview(REPO, 7)
    expect(withPending.callsTo('DiscardReview')[0]?.vars).toEqual({ reviewId: 'PRR_p' })

    const without = fakeGql({ Viewer: VIEWER, PendingReview: pendingLookup(null) })
    await new GitHubForge({ gql: without.gql }).discardPendingReview(REPO, 7)
    expect(without.ops()).toEqual(['Viewer', 'PendingReview'])
  })
})

describe('buildSearchQuery', () => {
  it('replaces the open restriction for closed/merged and removes it for all states', () => {
    expect(buildSearchQuery(REPO, { state: 'closed', author: 'alice' })).toBe(
      'repo:acme/widgets is:pr is:closed author:alice',
    )
    expect(buildSearchQuery(REPO, { state: 'merged' })).toBe('repo:acme/widgets is:pr is:merged')
    expect(buildSearchQuery(REPO, { state: 'all' })).toBe('repo:acme/widgets is:pr')
  })
  it('composes qualifiers with repo/is:pr/is:open', () => {
    expect(buildSearchQuery(REPO, { text: 'fix login', author: 'alice' })).toBe(
      'repo:acme/widgets is:pr is:open fix login in:title author:alice',
    )
  })

  it('quotes branch names with special characters and phrase-quotes text containing colons', () => {
    expect(buildSearchQuery(REPO, { head: 'feat/x', base: 'main' })).toBe(
      'repo:acme/widgets is:pr is:open head:"feat/x" base:main',
    )
    expect(buildSearchQuery(REPO, { text: 'is:closed hijack' })).toBe(
      'repo:acme/widgets is:pr is:open "is:closed hijack" in:title',
    )
  })

  it('passes a bare hex SHA without in:title so GitHub matches it by commit', () => {
    expect(buildSearchQuery(REPO, { text: 'a9eb1caf5159' })).toBe(
      'repo:acme/widgets is:pr is:open a9eb1caf5159',
    )
    expect(buildSearchQuery(REPO, { text: 'a9eb1caf5159z' })).toBe(
      'repo:acme/widgets is:pr is:open a9eb1caf5159z in:title',
    )
  })

  it('maps draft both ways and skips empty fields', () => {
    expect(buildSearchQuery(REPO, { draft: true })).toBe(
      'repo:acme/widgets is:pr is:open draft:true',
    )
    expect(buildSearchQuery(REPO, { draft: false })).toBe(
      'repo:acme/widgets is:pr is:open draft:false',
    )
    expect(buildSearchQuery(REPO, { text: '   ', author: '' })).toBe(
      'repo:acme/widgets is:pr is:open',
    )
  })
})

describe('GitHubForge.listPullRequestPage — filters', () => {
  it('uses the full repository connection for state-only browsing and maps closed states', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrList: () => ({
        repository: {
          pullRequests: conn(
            [rawSummary({ state: 'CLOSED' }), rawSummary({ id: 'merged', state: 'MERGED' })],
            { hasNextPage: false, endCursor: null },
            2400,
          ),
        },
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const page = await forge.listPullRequestPage(REPO, 1, { state: 'closed' })
    expect(page.total).toBe(2400)
    expect(page.items.map((p) => p.state)).toEqual(['CLOSED', 'MERGED'])
    expect(fake.callsTo('PrList')[0]?.vars.states).toEqual(['CLOSED', 'MERGED'])
    await forge.listPullRequestPage(REPO, 1, { state: 'all' })
    expect(fake.callsTo('PrList')[1]?.vars.states).toEqual(['OPEN', 'CLOSED', 'MERGED'])
    expect(fake.callsTo('PrSearch')).toHaveLength(0)
  })

  it('uses the search query with the built filter string and maps results with issueCount as total', async () => {
    const fake = fakeGql({
      Viewer: VIEWER,
      PrSearch: (_vars) => ({
        search: conn(
          [rawSummary({ id: 'PR_9', number: 9 })],
          { hasNextPage: false, endCursor: null },
          1,
        ),
      }),
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const page = await forge.listPullRequestPage(REPO, 1, { author: 'alice' })
    expect(page.items.map((p) => p.number)).toEqual([9])
    expect(page).toMatchObject({ total: 1, totalPages: 1 })
    expect(fake.callsTo('PrSearch')[0]?.vars.query).toBe(
      'repo:acme/widgets is:pr is:open author:alice',
    )
    expect(fake.callsTo('PrList')).toHaveLength(0)
  })

  it('pages filtered results through cursors like the plain list', async () => {
    const all = Array.from({ length: 150 }, (_, i) =>
      rawSummary({ id: `PR_${i + 1}`, number: i + 1 }),
    )
    const fake = fakeGql({
      Viewer: VIEWER,
      PrSearch: (vars) => {
        const start = vars.after === undefined ? 0 : Number(vars.after) * 100
        const nodes = all.slice(start, start + 100)
        const pageNumber = start / 100
        return {
          search: conn(
            nodes,
            {
              hasNextPage: pageNumber < 1,
              endCursor: pageNumber < 1 ? String(pageNumber + 1) : null,
            },
            150,
          ),
        }
      },
    })
    const forge = new GitHubForge({ gql: fake.gql })
    const p1 = await forge.listPullRequestPage(REPO, 1, { draft: true })
    const p2 = await forge.listPullRequestPage(REPO, 2, { draft: true })
    expect(p1.items).toHaveLength(100)
    expect(p2.items.map((p) => p.number)).toEqual(all.slice(100).map((p) => p.number))
    expect(fake.callsTo('PrSearch').map((c) => c.vars.after)).toEqual([undefined, '1'])
  })

  it('keeps filter cursors independent from the unfiltered list cursors', async () => {
    let listCalls = 0
    let searchCalls = 0
    const fake = fakeGql({
      Viewer: VIEWER,
      PrList: () => {
        listCalls += 1
        return { repository: { pullRequests: conn([rawSummary({ number: 1 })]) } }
      },
      PrSearch: () => {
        searchCalls += 1
        return { search: conn([rawSummary({ number: 2 })]) }
      },
    })
    const forge = new GitHubForge({ gql: fake.gql })
    await forge.listPullRequestPage(REPO, 1)
    await forge.listPullRequestPage(REPO, 1, { text: 'x' })
    await forge.listPullRequestPage(REPO, 1, { text: 'x' })
    expect(listCalls).toBe(1)
    expect(searchCalls).toBe(2)
  })
})
