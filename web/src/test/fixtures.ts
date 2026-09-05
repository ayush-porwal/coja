import type { Project, PullRequestSummary, SetupStatus } from '@coja/shared/api'

export function setupStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    gh: { ok: true, login: 'octocat', host: 'github.com' },
    providers: { openai: { configured: false }, anthropic: { configured: false } },
    secrets: { backend: 'keychain' },
    setupComplete: true,
    ...overrides,
  }
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    kind: 'local',
    owner: 'octo',
    repo: 'repo',
    path: '/Users/me/src/repo',
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

export function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    id: 'PR_1',
    number: 42,
    title: 'Add the thing',
    author: { login: 'hubot', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
    headRefName: 'feat/thing',
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    baseRefOid: 'b'.repeat(40),
    updatedAt: '2026-09-05T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    isDraft: false,
    url: 'https://github.com/octo/repo/pull/42',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    myReviewState: 'none',
    ...overrides,
  }
}
