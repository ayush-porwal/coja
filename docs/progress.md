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
