# coja — decisions where the design doc is silent

Each entry: the choice, and why it is the simplest option consistent with [design.md](design.md).

- **Design doc provenance.** `docs/design.md` did not exist in the working tree; two copies existed under `.delta/worktrees/*/coja/docs/`. Adopted the newest (2026-09-04 23:16) because it is the one containing the "Build order" and "Screens and UX flow" sections the build brief references.
- **Package manager / workspaces:** pnpm workspaces (`server/`, `web/`). The publishable package is `server/` (npm name `coja`); `web/` builds into `server/public/` which is included in the published files.
- **Server framework:** Hono on `@hono/node-server` (design offers Hono or Fastify; Hono has the smaller surface and streams well).
- **SQLite:** Node's built-in `node:sqlite` (no native build step for `npx coja`; requires Node ≥ 22.13, declared in `engines`).
- **Fetched PR refs are namespaced.** `git fetch origin +refs/pull/<n>/head:refs/coja/pull/<n>/head` (and the base branch tip to `refs/coja/pull/<n>/base`). Keeps objects reachable (no GC) without touching the user's branches or FETCH_HEAD semantics.
- **App-managed clones are bare.** `owner/repo` projects are cloned with `git clone --bare` into the app data dir; a bare repo has no working tree by construction. Credentials come from `gh auth git-credential` configured as the repo-local credential helper, so no token is written to disk.
- **Diff base is the merge base** (`git merge-base base head`), matching GitHub's own PR diff.
- **Thread replies follow GitHub's own rule.** We call `addPullRequestReviewThreadReply` without a pending-review id. Verified live: when the viewer has no pending review GitHub publishes the reply immediately (as a one-comment COMMENTED review); when a pending review is open GitHub attaches the reply to it, so it stays invisible until the review is submitted — exactly what github.com does. The API response reports which happened via `comment.isPending`, and the UI renders it accordingly.
- **Lint/format:** Biome (single tool for both, zero config churn). Unit tests: Vitest.
- **Versions pinned at scaffold time (2026-09-04):** TypeScript 5.9 (not 6/7, to stay on the stable line the toolchain agrees on), `@types/node` 22.x to match the `engines` floor, react-router 7, Hono 4 with `@hono/node-server` 2, Vite 8, Vitest 5, Biome 2.5, React 19.
- **Static serving is hand-rolled** (small mime map + SPA fallback) instead of `serveStatic`, so it works regardless of `process.cwd()` when launched via `npx coja`.
- **`ref=base` for blobs means the merge base**, not the base-branch tip — that is what the diff's LEFT side shows, so "read the old version" (UI and AI `read_file(base, …)`) stays consistent with the patch. The branch tip is still fetched to `refs/coja/pull/<n>/base`.
- **App-managed clones reset `credential.helper`** to empty and then `!gh auth git-credential` (as `gh auth setup-git` does) so an inherited `osxkeychain` helper cannot shadow gh with a stale credential.
