# E2E fixture

Private scratch repo used for all review-flow validation.

- Repo: `ayush-porwal/coja-e2e-fixture` (https://github.com/ayush-porwal/coja-e2e-fixture)
- PR: #1 "Session rotation with audit log" — `feature/session-rotation` → `main`
  - PR node id: `PR_kwDOUOt7o88AAAABCQ1ReA`
  - base `be001d5`, head `f634972`
- Diff shape: 2 edits (`src/auth/session.ts`, `src/index.ts`, `docs/architecture.md`), 3 adds (`src/auth/audit.ts`, `src/auth/session.test.ts`, `src/util/timezones.ts` ≈2400 lines), 1 rename (`src/auth/token.ts` → `src/auth/bearer.ts`).
- Seeded state: one published review thread on `src/auth/session.ts:12` (RIGHT) — thread `PRRT_kwDOUOt7o86fcn75` — for reply tests; one top-level issue comment.
- Also present (not seeded by us): a "Codex Review" bot installed on the account posted a COMMENTED review with three inline threads (`src/auth/session.test.ts:3`, `src/index.ts:3`, `src/auth/session.ts:11`) at 2026-09-04T21:35Z. Real data; useful for rendering tests.
- Local source of the fixture (scratch, may be gone): the branches live on GitHub; a fresh clone is enough.

## Resetting between runs

```bash
# discard the viewer's pending review, if any
gh api graphql -f query='{ repository(owner:"ayush-porwal", name:"coja-e2e-fixture") { pullRequest(number:1) { reviews(states: PENDING, first: 5) { nodes { id } } } } }' \
  --jq '.data.repository.pullRequest.reviews.nodes[].id' \
  | xargs -I{} gh api graphql -f query='mutation { deletePullRequestReview(input:{pullRequestReviewId:"{}"}) { clientMutationId } }'
# unmark all files as viewed
gh api graphql -f query='{ repository(owner:"ayush-porwal", name:"coja-e2e-fixture") { pullRequest(number:1) { files(first:50) { nodes { path viewerViewedState } } } } }' \
  --jq '.data.repository.pullRequest.files.nodes[] | select(.viewerViewedState=="VIEWED") | .path' \
  | xargs -I{} gh api graphql -f query='mutation { unmarkFileAsViewed(input:{pullRequestId:"PR_kwDOUOt7o88AAAABCQ1ReA", path:"{}"}) { clientMutationId } }'
```

Submitted reviews cannot be deleted; each submit run leaves a review event on the PR, which is fine (the checks look for the newest event).
