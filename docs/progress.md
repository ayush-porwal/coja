# coja — build progress

Source of truth: [design.md](design.md). Choices where the design is silent: [decisions.md](decisions.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and validated

## Stage 1 — Scaffold
- [x] pnpm monorepo: `server/` (package `coja`, bin) + `web/` (Vite React)
- [x] `coja` bin starts server, serves built UI from package, opens browser
- [x] typecheck + lint + unit tests wired at root (`pnpm check`)
- [x] Validation: build once, `node server/bin/coja.js` serves UI in browser (2026-09-04, health + SPA fallback verified in browser)

## Stage 2 — Git layer + Forge + gh auth
- [x] `git` plumbing wrapper (show / ls-tree / grep / diff / log / blame / fetch / merge-base) — no worktree/checkout anywhere (145 unit tests; live fetch of fixture PR verified)
- [x] `Forge` interface + GitHub GraphQL implementation, token from `gh auth token` (63 unit tests; 18-step live check against fixture PR: pending comment, edit, viewed, reply, discard)
- [x] Setup screen: `gh auth status` surfaced, API key → keychain + validation, skippable (browser: gh green, bogus key → "That key was rejected by OpenAI.", Skip → Projects)
- [x] Validation: unit tests against a temp git repo ✔; setup screen in browser ✔

## Stage 3 — Projects → PR list → diff view
- [x] Add project by local clone path (origin auto-detected) and by `owner/repo` (bare clone into app storage) — both via API; local path also via the UI form (browser)
- [x] PR list: title, author, branch, updated-at, my review state (browser: 'Commented' badge on #1)
- [x] PR screen: background fetch of `pull/<n>/head`, metadata immediately (browser: Overview renders at once, pill Fetching→Ready)
- [~] Continuous lazily-rendered diff (`@pierre/diffs`), stacked/split toggle — renders + highlights; BUG open: tree jump-scroll lands off-target (virtualizer height estimate), fix agent running
- [x] Changed-files tree (`@pierre/trees`) with change types, comment badges, viewed checkmarks; Overview entry (browser)
- [ ] Validation: browser run against fixture PR

## Stage 4 — Review sync
- [x] Line/range comment → pending review (browser on #1; `gh api`: review PENDING, comment PENDING)
- [x] Reply to existing thread (browser: joins the open pending review with Pending badge; with no pending review it publishes immediately — both verified via `gh api`)
- [x] Viewed checkmark round-trips via `markFileAsViewed` (browser checkbox → `viewerViewedState: VIEWED` via `gh api`)
- [x] Submit: Comment (#1, publishes 2 pending comments) / Approve (#2) / Request changes (#2) — each verified via `gh api` (state, body, comments SUBMITTED). Note: GitHub forbids Approve/Request-changes on your own PR, hence the bot-authored PR #2 (workflow in the fixture repo).
- [ ] Validation: browser + `gh api` verification against fixture PR, twice from clean state

## Stage 5 — AI panel
- [x] Agent loop (Vercel AI SDK v7), exactly six read-only tools (`server/src/ai`; static invariant test forbids forge/child_process/fs/network imports; 45 tests incl. mock-model streaming)
- [x] Ask AI → context chip (visible, expandable, removable) — browser: `src/auth/session.ts:14–15 @ head`, expands to the exact text, × removes
- [~] Tool calls + results rendered in chat; `file:line` citations scroll diff — implemented + unit-tested (tool cards, remark citation plugin → bridge.scrollToLine); live browser check BLOCKED on an API key
- [~] Conversations persisted in SQLite; survive restart; new chat / history per PR — server persists on `onEnd` (tested); restart round-trip BLOCKED on an API key
- [x] Model picker; "what does the AI see?" affordance — browser: dialog shows the verbatim system prompt + six tools; no-provider notice links to Setup and the review tool keeps working
- [ ] Validation: browser with real provider key (BLOCKED until `OPENAI_API_KEY` provided)

## Cross-cutting
- [x] E2E fixture repo `coja-e2e-fixture` with PR #1 (adds, edits, rename, large file) — see e2e-fixture.md
- [~] Invariant audit — round 1 (Opus, server stages 2–4): Invariant 1 PASS, Invariant 2 PASS structurally; CSRF/DNS-rebinding gap (C1) + M3–M6/L7–L14 fixed and guard verified over HTTP. Round 2 (Opus, AI layer + guard + web): Invariant 1 PASS, Invariant 2 PASS, guard closes the cross-origin hole (with documented caveats); findings H1 (remote images in assistant markdown), M2 (CSP), M3 (wildcard bind), M4 (unbounded chat input), M5 (Ask AI on renamed file's LEFT side), L6–L11 being fixed.

## Resume notes (written 2026-09-04 23:55, before a usage-limit pause)

- Research reports (ground truth for library APIs) live in the session scratchpad: `research-pierre.md`, `research-github.md`, `research-aisdk.md`, `research-infra.md` under
  `/private/tmp/claude-501/-Users-ayush-porwal-Documents-workspace-coja/afd08bb9-0e4d-4d81-b350-d51ce84dc70e/scratchpad/`.
- Contracts written and committed: `server/src/shared/api.ts` (wire types + routes), `server/src/forge/forge.ts` (Forge interface), `server/src/routes/http.ts` (error mapping), `server/src/projects/store.ts`, `server/src/db.ts`, `server/src/context.ts`, `web/src/api/client.ts`.
- Dependencies pre-installed: server `ai@7.0.92 @ai-sdk/openai@4.0.58 @ai-sdk/anthropic@4.0.49 zod@4.5.4 @napi-rs/keyring@2.0.0`; web `@pierre/diffs@1.4.0 @pierre/trees@1.0.0-beta.6 ai @ai-sdk/react zod react-markdown remark-gfm`.
- Parallel implementation agents dispatched next (each confined to its paths): A git layer (`server/src/git`, `server/src/pr`, `server/src/projects/add.ts`, `routes/projects.ts`, `routes/git.ts`); B GitHub forge (`server/src/forge/*`, `routes/pulls.ts`, `routes/review.ts`); C web shell (`web/src/**` minus `pr/`); D secrets + setup (`server/src/secrets`, `routes/setup.ts`); E PR review screen (`web/src/pr/**`).
- After agents finish: wire `registerXRoutes` in `server/src/app.ts` + `cli.ts` (createContext, GitHubForge, PrFetcher, secret store), run `pnpm check`, build, start, browser-validate Stages 2–4 against the fixture PR, Opus invariant audit, then Stage 5 (AI panel: server `server/src/ai/**` + `routes/chat.ts`; web `web/src/pr/ai/**`).
- `OPENAI_API_KEY` is absent in the environment: final AI-panel validation needs a key from the user.
- **2026-09-05 00:0x — paused on user request (usage limits).** All five implementation agents (A–E) were STOPPED mid-work to save credits. Their partial, uncommitted files may exist under `server/src/{git,pr,projects,forge,secrets,routes}` and `web/src/**`. On resume (cron fires 04:24): run `git status`, inspect what each agent left, then re-dispatch agents A–E with the same briefs plus "build on the partial files already present; review them first". Nothing from A–E is committed.
