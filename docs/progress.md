# coja — build progress

Source of truth: [design.md](design.md). Choices where the design is silent: [decisions.md](decisions.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and validated

## Stage 1 — Scaffold
- [x] pnpm monorepo: `server/` (package `coja`, bin) + `web/` (Vite React)
- [x] `coja` bin starts server, serves built UI from package, opens browser
- [x] typecheck + lint + unit tests wired at root (`pnpm check`)
- [x] Validation: build once, `node server/bin/coja.js` serves UI in browser (2026-09-04, health + SPA fallback verified in browser)

## Stage 2 — Git layer + Forge + gh auth
- [ ] `git` plumbing wrapper (show / ls-tree / grep / diff / log / blame / fetch / merge-base) — no worktree/checkout anywhere
- [ ] `Forge` interface + GitHub GraphQL implementation, token from `gh auth token`
- [ ] Setup screen: `gh auth status` surfaced, API key → keychain + validation, skippable
- [ ] Validation: unit tests against a temp git repo; setup screen in browser

## Stage 3 — Projects → PR list → diff view
- [ ] Add project by local clone path (origin auto-detected) and by `owner/repo` (bare clone into app storage)
- [ ] PR list: title, author, branch, updated-at, my review state
- [ ] PR screen: background fetch of `pull/<n>/head`, metadata immediately
- [ ] Continuous lazily-rendered diff (`@pierre/diffs`), stacked/split toggle
- [ ] Changed-files tree (`@pierre/trees`) with change types, comment badges, viewed checkmarks; Overview entry
- [ ] Validation: browser run against fixture PR

## Stage 4 — Review sync
- [ ] Line/range comment → pending review (verified pending on GitHub via `gh api`)
- [ ] Reply to existing thread
- [ ] Viewed checkmark round-trips via `markFileAsViewed`
- [ ] Submit: Approve / Request changes / Comment → correct review event
- [ ] Validation: browser + `gh api` verification against fixture PR, twice from clean state

## Stage 5 — AI panel
- [ ] Agent loop (Vercel AI SDK), exactly six read-only tools
- [ ] Ask AI → context chip (visible, expandable, removable)
- [ ] Tool calls + results rendered in chat; `file:line` citations scroll diff
- [ ] Conversations persisted in SQLite; survive restart; new chat / history per PR
- [ ] Model picker; "what does the AI see?" affordance
- [ ] Validation: browser with real provider key (BLOCKED until `OPENAI_API_KEY` provided)

## Cross-cutting
- [x] E2E fixture repo `coja-e2e-fixture` with PR #1 (adds, edits, rename, large file) — see e2e-fixture.md
- [ ] Invariant audit (no worktree/checkout; no shell/write/network tool; no mutation reachable from agent output)

## Resume notes (written 2026-09-04 23:55, before a usage-limit pause)

- Research reports (ground truth for library APIs) live in the session scratchpad: `research-pierre.md`, `research-github.md`, `research-aisdk.md`, `research-infra.md` under
  `/private/tmp/claude-501/-Users-ayush-porwal-Documents-workspace-coja/afd08bb9-0e4d-4d81-b350-d51ce84dc70e/scratchpad/`.
- Contracts written and committed: `server/src/shared/api.ts` (wire types + routes), `server/src/forge/forge.ts` (Forge interface), `server/src/routes/http.ts` (error mapping), `server/src/projects/store.ts`, `server/src/db.ts`, `server/src/context.ts`, `web/src/api/client.ts`.
- Dependencies pre-installed: server `ai@7.0.92 @ai-sdk/openai@4.0.58 @ai-sdk/anthropic@4.0.49 zod@4.5.4 @napi-rs/keyring@2.0.0`; web `@pierre/diffs@1.4.0 @pierre/trees@1.0.0-beta.6 ai @ai-sdk/react zod react-markdown remark-gfm`.
- Parallel implementation agents dispatched next (each confined to its paths): A git layer (`server/src/git`, `server/src/pr`, `server/src/projects/add.ts`, `routes/projects.ts`, `routes/git.ts`); B GitHub forge (`server/src/forge/*`, `routes/pulls.ts`, `routes/review.ts`); C web shell (`web/src/**` minus `pr/`); D secrets + setup (`server/src/secrets`, `routes/setup.ts`); E PR review screen (`web/src/pr/**`).
- After agents finish: wire `registerXRoutes` in `server/src/app.ts` + `cli.ts` (createContext, GitHubForge, PrFetcher, secret store), run `pnpm check`, build, start, browser-validate Stages 2–4 against the fixture PR, Opus invariant audit, then Stage 5 (AI panel: server `server/src/ai/**` + `routes/chat.ts`; web `web/src/pr/ai/**`).
- `OPENAI_API_KEY` is absent in the environment: final AI-panel validation needs a key from the user.
