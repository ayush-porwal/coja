import type {
  ConversationItem,
  PullRequestDetail,
  ReviewComment,
  ReviewThread,
} from '@coja/shared/api'

export function makeComment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'C1',
    body: 'Looks good',
    bodyHTML: '<p>Looks good</p>',
    author: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
    createdAt: '2026-09-01T10:00:00Z',
    isPending: false,
    isMine: false,
    ...over,
  }
}

export function makeThread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'T1',
    path: 'src/auth/session.ts',
    line: 12,
    startLine: null,
    side: 'RIGHT',
    startSide: null,
    originalLine: 12,
    isResolved: false,
    isOutdated: false,
    comments: [makeComment()],
    ...over,
  }
}

export function makeDetail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  const conversation: ConversationItem[] = [
    {
      kind: 'comment',
      id: 'IC1',
      author: { login: 'reviewer' },
      body: 'Top-level comment',
      bodyHTML: '<p>Top-level <em>comment</em></p>',
      createdAt: '2026-09-02T09:00:00Z',
      url: 'https://github.com/o/r/pull/1#issuecomment-1',
    },
    {
      kind: 'review',
      id: 'RV1',
      author: { login: 'approver' },
      body: 'Ship it',
      bodyHTML: '<p>Ship it</p>',
      state: 'APPROVED',
      submittedAt: '2026-09-03T09:00:00Z',
      commentCount: 2,
    },
  ]
  return {
    id: 'PR_1',
    number: 1,
    title: 'Session rotation with audit log',
    author: { login: 'ayush', avatarUrl: 'https://avatars.githubusercontent.com/u/2' },
    headRefName: 'feature/session-rotation',
    baseRefName: 'main',
    headRefOid: 'f634972',
    baseRefOid: 'be001d5',
    updatedAt: '2026-09-03T10:00:00Z',
    createdAt: '2026-09-01T08:00:00Z',
    isDraft: false,
    url: 'https://github.com/o/r/pull/1',
    additions: 120,
    deletions: 30,
    changedFiles: 3,
    myReviewState: 'none',
    body: 'Rotates sessions.\n\n- adds audit log',
    bodyHTML: '<p>Rotates <strong>sessions</strong>.</p><ul><li>adds audit log</li></ul>',
    commits: [
      {
        oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        abbreviatedOid: 'aaaaaaa',
        messageHeadline: 'Rotate sessions on login',
        messageBody: '',
        authorName: 'Ayush Porwal',
        authorLogin: 'ayush',
        committedDate: '2026-09-01T08:30:00Z',
        url: 'https://github.com/o/r/commit/aaaaaaa',
      },
      {
        oid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        abbreviatedOid: 'bbbbbbb',
        messageHeadline: 'Add audit log',
        messageBody: 'Details',
        authorName: 'Someone Else',
        committedDate: '2026-09-02T08:30:00Z',
        url: 'https://github.com/o/r/commit/bbbbbbb',
      },
    ],
    files: [
      {
        path: 'src/auth/session.ts',
        additions: 50,
        deletions: 20,
        changeType: 'MODIFIED',
        viewedState: 'UNVIEWED',
      },
      {
        path: 'src/auth/audit.ts',
        additions: 60,
        deletions: 0,
        changeType: 'ADDED',
        viewedState: 'VIEWED',
      },
      {
        path: 'src/auth/bearer.ts',
        additions: 10,
        deletions: 10,
        changeType: 'RENAMED',
        viewedState: 'DISMISSED',
      },
    ],
    threads: [makeThread()],
    conversation,
    pendingReview: null,
    viewer: { login: 'ayush' },
    ...over,
  }
}
