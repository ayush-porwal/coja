# Sign in with ChatGPT — research for coja's subscription provider

Status: implemented per §6. Written 2026-09-05. Everything below was verified against
primary sources on this date: the `chatgpt-oauth` PROTOCOL.md and source, opencode's
Codex auth plugin source, the Codelynx writeup, and OpenAI's official Codex auth docs
(`developers.openai.com/codex/auth`, which now redirects to `learn.chatgpt.com/docs/auth`).

The one-paragraph version: third-party desktop apps ride OpenAI's **public Codex CLI
OAuth client** (`app_EMoamEEZ73f0CkXaXp7hrann`, a public client with no secret) through
a loopback authorization-code flow with PKCE on `127.0.0.1:1455`, receive
access/refresh tokens whose JWT carries the ChatGPT account id and plan type, and then
call **`https://chatgpt.com/backend-api/codex/responses`** — a Responses-style API that
bills the ChatGPT subscription instead of an API key. The endpoint is undocumented and
revocable; OpenAI has tolerated this exact pattern in opencode and community SDKs
without pushback — and OpenAI has since said publicly that this is supported for
now. For coja this is an **opt-in subscription provider** with an API-key fallback,
per design.md ("Model providers").

---

## 1. The mechanism

### 1.1 Fixed constants

| Name | Value |
|---|---|
| OAuth client ID | `app_EMoamEEZ73f0CkXaXp7hrann` (public client, no secret) |
| Issuer / authorize | `https://auth.openai.com/oauth/authorize` |
| Token endpoint | `https://auth.openai.com/oauth/token` |
| Scope | `openid profile email offline_access` |
| Loopback redirect | `http://localhost:1455/auth/callback` — bind `127.0.0.1:1455` only |
| Device verification | `https://auth.openai.com/codex/device` (user enters a one-time code) |
| Responses transport | `https://chatgpt.com/backend-api/codex/responses` |
| Refresh margin | refresh when `expiresAt − now < 120 s` |

Endpoints must be configurable in code for tests (all research sources agree on this).

### 1.2 Flow variants, and which fits coja

**A. Loopback redirect + PKCE (Codex CLI's default; opencode's browser path).**
Open `…/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=http://localhost:1455/auth/callback&scope=openid profile email offline_access&code_challenge=<S256(verifier)>&code_challenge_method=S256&state=<32 B base64url>&id_token_add_organizations=true&codex_cli_simplified_flow=true`. A tiny HTTP server bound to `127.0.0.1:1455` (the client_id's registered redirect — the port is not free to choose; every implementation uses 1455) accepts exactly `/auth/callback` once, validates `state` before touching `code`, rejects an OAuth `error`, then form-POSTs the token endpoint (`grant_type=authorization_code&client_id=…&code=…&code_verifier=…&redirect_uri=…`) — no client secret exists or is sent. Deadline 5 minutes; the callback page must be small, self-contained, non-cached HTML with no callback values interpolated into it.

**B. Device authorization flow (Codex CLI's `--device-auth` beta; opencode's "headless" path; the Codelynx SaaS path).** POST `{"client_id"}` to `…/api/accounts/deviceauth/usercode` → `{device_auth_id, user_code, interval}`; the user opens `https://auth.openai.com/codex/device` and types the code; poll `…/deviceauth/token` with `{device_auth_id, user_code}` every `interval` s (403/404 = still pending, `slow_down` = +5 s, deadline = expired); success yields `{authorization_code, code_verifier}` which is exchanged like flow A with `redirect_uri=https://auth.openai.com/deviceauth/callback`.

**Fit for coja (a localhost server app with a browser UI): flow A.** The user is already
on the same machine with a browser; flow A is one click in an already-open browser, it is
the path the Codex CLI itself defaults to (most-tested), and it needs no polling loop.
Official docs note flow B is **beta and must be enabled** in the user's ChatGPT security
settings or workspace permissions — a support burden coja should not adopt first. Flow A's
only failure mode is port 1455 being occupied (Codex CLI left a listener up); that is a
clear, actionable error. Device flow stays documented here as the future headless fallback.

**Where the flow runs: an ephemeral listener, not a route on coja's app server.** The
registered redirect URI pins port 1455, while coja's own server is on an arbitrary port —
so, like opencode, the connect action binds a temporary `http.Server` on `127.0.0.1:1455`
for the duration of the flow (max 5 min) and closes it on first callback or deadline.
The app's request guard (POST same-origin rule, etc.) is therefore not involved; the
ephemeral server accepts only `GET /auth/callback` and `/cancel`.

### 1.3 Tokens, metadata, lifecycle

Token response requires `access_token`, `refresh_token`, numeric `expires_in`
(`expiresAt = now + expires_in*1000`, no margin subtracted at issuance); `id_token` may
be present. Unverified JWT payload metadata (decode only, no signature check — the
client has no trusted verification step):

- `payload["https://api.openai.com/auth"].chatgpt_account_id` → **account id** (also
  found top-level or as `organizations[0].id`; prefer the namespaced claim)
- `…chatgpt_plan_type` → plan (`plus`, `pro`, …) — display only
- `payload.email` → account email — display only

**Refresh**: form POST `grant_type=refresh_token&client_id=…&refresh_token=…` (scope
optional). If the response omits `refresh_token`, keep the old one. Refresh inside the
120 s margin. **Singleflight**: all callers share one in-process refresh promise per
store; the promise re-loads the record and re-checks staleness after acquiring, and is
cleared in `finally`. (The community protocol also mandates compare-and-swap versioning
for multi-process stores; coja's tokens live in one process's SecretStore, so
in-process singleflight + reload is the honest equivalent.)

**Terminal classification**: a token-endpoint reply that is an OAuth error
`invalid_grant` / `invalid_token` / `invalid_request`, or a bare 401/403, means the
credential generation is dead → mark connection `auth_expired` (their "quarantine"):
every later request fails fast with a typed reauth error, no network. Never classify
429, 5xx, timeouts or DNS failures this way; those are retryable. Only a fresh login
clears the state.

**Revocation**: there is **no dependable public revoke endpoint** for this client
(PROTOCOL.md §6; Codelynx likewise makes no upstream call). "Disconnect" therefore
means: delete the keychain record and the non-secret mirror, and reset in-memory state.
The refresh token's server-side lifetime ends naturally when the user revokes sessions
in ChatGPT settings — the UI should say so.

### 1.4 The Codex Responses transport

`POST https://chatgpt.com/backend-api/codex/responses?client_version=<v>` — a
**Responses-style** API (same item vocabulary as `/v1/responses`), not the Chat
Completions API and not the standard platform endpoint. Required headers:

```
authorization: Bearer <access token>
chatgpt-account-id: <accountId>          # omit when unknown
openai-beta: responses=experimental
originator: codex_cli_rs
content-type: application/json
session_id: <one UUID v4 per client instance, reused>
```

(`client_version` in the query is required — the backend 400s without it; track the
Codex CLI version in a constant, currently `0.144.6`. opencode instead sends
`originator: opencode` and their own User-Agent and works, which shows the backend
tolerates variation — but the codex-shaped values are the most-tested.)

Body: `{model, instructions?, input: […], tools?, tool_choice?, parallel_tool_calls: false, store: false, stream: true, reasoning?, include?}` — the three fixed fields always exactly so; both streaming and collected reads use `stream: true`.

Hard rejections (each fails the whole request with `400 {"detail":"Unsupported parameter: <name>"}`, naming only the first offender): `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `logit_bias`, `max_output_tokens`, `max_tool_calls`, `metadata`, `safety_identifier`, `seed`, `top_logprobs`, `truncation`, `user`; `stream_options` fails as an unknown parameter. `input` must be a **list** (a bare string → `400 {"detail":"Input must be a list"}`). Accepted extras: `reasoning`, `include`, `prompt_cache_key`, `service_tier`, `text` (verbosity / json_schema).

Because `store:false` is mandatory, multi-turn tool loops must echo reasoning items
back: request `include: ["reasoning.encrypted_content"]` and return prior
`reasoning` items (with their `encrypted_content`) in `input`, or the backend can
reject a `function_call` whose required `reasoning` item is missing.

Error handling on this transport (community-verified):

- **401**: force a singleflight refresh, retry **once**; a second 401 is a typed auth
  error (→ reconnect).
- **429**: rate-limit/plan-quota error; honour `Retry-After`. Successful responses
  carry plan-usage headers `x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}`.
- **other non-2xx**: typed transport error with a redacted, bounded body snippet.

SSE framing is standard: `event:`/`data:` blocks, `[DONE]` sentinel, incremental UTF-8
decode tolerant of chunk splits mid-event. Deltas arrive as `response.output_text.delta`;
turn items as `response.output_item.done` (a reasoning item arrives whole here, with its
`encrypted_content`); final state in `response.completed` — **which carries
`output: []` on this backend** (unlike the platform API), so a client that rebuilds the
response must collect `output_item.done` items itself. `response.failed` / `error`
events carry the turn's failure.

### 1.5 Redaction invariants (adopted wholesale)

No token in any thrown message, log line, or stored preview: strip
`Bearer <value>` → `Bearer [REDACTED]` and the JSON/form values of `access_token`,
`refresh_token`, `id_token`, `authorization` **before** truncating a snippet. Never log
request headers or the stored record. Classify by stable error codes, never by matching
human-readable strings.

## 2. Prior art (actual code read)

### (a) opencode — `packages/opencode/src/plugin/openai/codex.ts` (repo moved to anomalyco/opencode, branch `dev`, read 2026-09-05)

The most complete production implementation. Confirms every constant in §1; their
flow: ephemeral `http.createServer` on **1455** with a 5-minute callback timeout and
success/error HTML pages; PKCE (43-char verifier); state = 32 random bytes base64url;
`id_token_add_organizations`, `codex_cli_simplified_flow`, plus their own
`originator=opencode` authorize param. Account id extracted from `id_token` first, then
`access_token` JWT claims (`chatgpt_account_id` → namespaced claim → `organizations[0].id`).
Refresh: single in-process `refreshPromise` cleared in `finally` — exactly the
singleflight shape. Transport: a custom `fetch` around their OpenAI provider that deletes
the SDK's `authorization` header, sets `Bearer` + `ChatGPT-Account-Id` after refresh,
rewrites any `/v1/responses` or `/chat/completions` path to the Codex endpoint, adds
`originator`/`User-Agent`/`session-id` headers, and sets `maxOutputTokens = undefined`
("match codex cli" — the backend rejects the parameter). Models: a **static allow-list**
filtered per plan — currently `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`,
excluding `gpt-5.5-pro` (pro-gated) and `gpt-5.6`; context 400k/input 272k/output 128k
for 5.5+. They also ship the device flow verbatim as the "headless" auth method.

### (b) `chatgpt-oauth` (npm `chatgpt-oauth@0.4.0`, github.com/vishhvak/chatgpt-oauth, MIT)

Single-maintainer experimental library whose PROTOCOL.md is the best public
language-neutral spec of this wire (§1 above is heavily cross-checked against it).
Ships `core` (oauth/pkce/sse/redact/jwt/store), Node loopback + file store, React/Next
bindings, images + realtime transports, an app-server JSON-RPC client, and an **AI SDK
bridge** (`chatgpt-oauth/ai-sdk`) whose entire trick is: `createOpenAI({ apiKey: "placeholder",
baseURL: "https://chatgpt.com/backend-api/codex", fetch: authFetch }).responses` — i.e.
**the stock `@ai-sdk/openai` Responses provider plus a wrapped `fetch`** that (1) rewrites
the body to `stream:true, store:false, parallel_tool_calls:false` and deletes the
unsupported-parameter list, (2) appends `client_version`, (3) injects bearer /
account-id / beta / originator / session headers, (4) retries once on 401 through a
forced refresh, and (5) for non-streaming calls, collapses the SSE stream back into one
JSON response — restoring `output` from `output_item.done` events because
`response.completed.output` is empty on this backend. Their error taxonomy is a base
class with stable codes (`state_mismatch`, `reauth_required`, `token_refresh`,
`rate_limit`, `auth`, `transport`, `store`, `disabled`).

### (c) Codelynx — "How I added Sign in with ChatGPT to a SaaS" (codelynx.dev/posts/tchao-sign-in-with-chatgpt)

A hosted-SaaS take (multi-tenant, hence device flow + AES-256-GCM encryption of the
record, a Convex table, and browser-driven polling — none of which coja needs; our
single-user localhost app keeps tokens in the OS keychain with no new crypto). The
transferable parts: their **AI SDK adapter is the same shape** — `createOpenAI` with
`baseURL` pointed at the Codex backend and a `createCodexFetch` wrapper that injects
auth headers, rewrites the path, appends `client_version`, sets `store:false`, adds
`include: ["reasoning.encrypted_content"]`, and **strips `max_output_tokens` and
server-side item ids** (skipping this causes `AI_NoOutputGeneratedError`); their model
list comes from the connected account's catalog endpoint with a junk internal model
filtered out; and they re-validate the connection on every generation rather than only
at connect time, routing refresh-token death into a visible fallback instead of a dead
conversation.

### (d) Official docs — developers.openai.com/codex/auth

Sanctions: ChatGPT sign-in for Codex (CLI/desktop/IDE), browser flow with the
**localhost:1455 callback**, device-auth as **beta** needing enablement, automatic
refresh, credentials in `~/.codex/auth.json` or the OS keyring; subscription usage
follows workspace permissions/RBAC, API-key auth bills usage-based instead. It is
**silent on third-party reuse** — neither blessing nor forbidding. The practice
(opencode shipping it as a first-class auth method; Roo Code shipping "ChatGPT
Pro/Plus integration"; multiple community SDKs; an OpenAI community thread where staff
discuss client-id best practice for "consumers of the OpenAI OAuth bridge") is
consistent with tolerance, not with endorsement. OpenAI has since confirmed
publicly (2026) that this sign-in is supported for third-party apps for now, so the
path ships as a normal provider — opt-in by nature (you connect an account instead
of pasting a key), with the engineering caution of §5 retained because the endpoint
is still not a published API contract.

## 3. Dependency decision — implement the flow ourselves (recommended)

Options: (A) depend on `chatgpt-oauth` (or `openai-oauth-provider`, `@openhax/codex`);
(B) implement the ~400 documented lines in `server/src/codex/` against the stock
`@ai-sdk/openai` Responses provider we already ship.

**Recommendation: B — no new runtime dependency.**

- **Auditability (decisive).** coja would hold live subscription credentials. `chatgpt-oauth`
  is 52 files / ~435 kB unpacked spanning react, react-native, next, realtime (WebRTC),
  images and an app-server RPC client — a wide surface to audit for exactly one narrow
  use, with auth sitting inside it. The part we actually need — PKCE, two form posts,
  a loopback listener, a fetch wrapper — is small enough to read in one sitting and
  pin with tests.
- **Bus factor / churn.** Single maintainer, self-described experimental, tracking an
  undocumented backend that has already changed at least once (client_version became
  required; images/realtime appeared). A pinned dependency does not protect against
  wire drift; our typed `endpoint-changed` error plus protocol mocks do, and the
  PROTOCOL.md gives us a re-verifiable spec to diff against when something breaks.
- **Fit with AI SDK v7.** The library's own bridge is `createOpenAI(...).responses` +
  a fetch wrapper — i.e. ~80 lines around the same `@ai-sdk/openai` version family we
  already depend on (`@ai-sdk/openai@4.0.58`, whose `.responses()` accepts a custom
  `fetch` and round-trips `reasoningEncryptedContent` through provider options, which
  is what makes `store:false` tool loops work). Taking the dependency to obtain eighty
  lines we can write against their MIT reference is the wrong trade; keeping our
  wrapper in-tree also lets coja's error taxonomy be coja's (`quota` / `auth-expired`
  / `endpoint-changed`) instead of mapping theirs.
- **Size.** Net addition ≈ 400 lines + tests, zero new runtime deps (Node's `crypto`
  and `http` cover PKCE, JWT-decode and the loopback listener).

Fallback if B rots: the dependency remains one `pnpm add` away, and `server/src/codex/`
is deliberately shaped so the fetch-wrapper seam could be re-pointed at a library
implementation without touching the provider surface.

## 4. Model + limit mapping

**Picker entries (provider `chatgpt`, wire id `chatgpt:<model>`).** The backend publishes a
per-account model catalog at `GET https://chatgpt.com/backend-api/codex/models?client_version=…`
(same subscription headers as `/responses`; 400 without `client_version`). Each entry carries
`slug`, `display_name`, `visibility` (`list`/`hide` — `gpt-reserve` and `codex-auto-review` are
hidden plumbing), `context_window`, `supported_reasoning_levels` (`{effort, description}` —
observed `low|medium|high|xhigh|max|ultra` depending on model) and `default_reasoning_level`.
coja's picker is driven by this endpoint (TTL-cached, mirrored non-secret in the settings DB for
outages, short static bootstrap list as the last resort); reasoning efforts are sent as
`reasoning: {effort}` in the transport body — including `ultra`, which the AI SDK's own
provider-option schema does not know. Verified live 2026-09-05 (Plus account): `gpt-5.6-sol`
(default low), `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini`. Earlier note, kept
for history — opencode ships a static plan-filtered allow-list, and coja originally curated:

| curated id | label | note |
|---|---|---|
| `gpt-5.5` | GPT-5.5 | flagship non-pro tier |
| `gpt-5.4` | GPT-5.4 | |
| `gpt-5.4-mini` | GPT-5.4 mini | cheap/fast default for PR reading |
| `gpt-5.3-codex-spark` | GPT-5.3 Codex Spark | codex-tuned |

Excluded: `gpt-5.5-pro` (pro-gated, "reasoningMode pro" refused), `gpt-5.6` (opencode
explicitly excludes). Context limits for 5.5+: 400k context / 272k input / 128k output;
the backend rejects `max_output_tokens`, so our harness's `maxOutputTokens` is dropped
in the transport rewrite. The list is verified live in Phase C against the signing-in
user's plan; an unknown model fails with the backend's 400 naming the model, which the
UI shows verbatim (the picker only offers curated ids, so this surfaces only if a plan
loses a model — honest, not silent).

Default model: the first configured provider's first curated model, ordered
`openai` → `anthropic` → `chatgpt` (a subscription is never silently preferred over an
explicitly pasted key… but the picker makes switching one click).

**How plan limits surface.** Successful responses carry
`x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}` headers (5h and
weekly windows) — coja v1 does not display them; the chat just works until it doesn't.
Exhaustion arrives as **HTTP 429** (honour `Retry-After`; the body describes the plan
window) → typed **quota error** → honest chat-panel message including the backend's own
reset wording. Auth death arrives as a second 401 after a forced refresh, or a terminal
token-endpoint error (`invalid_grant`/401/403) → typed **auth-expired** → "reconnect in
Setup". Other non-2xx (including a moved/gone endpoint, HTML error pages, 5xx-shaped
capacities) → typed **endpoint-changed/transport** → "the ChatGPT backend refused or
moved; use your API key and check for a coja update".

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Endpoint is not a published API contract; OpenAI can evolve it | medium | Not the default billing path; typed `endpoint-changed` error surfaces drift as an honest message; protocol constants live in one file, so adaptation is a diff, and tests re-verify the wire from PROTOCOL.md |
| OpenAI tightens the terms later | low (publicly supported for now) | API-key path remains fully first-class, and switching to it is one click — never automatic |
| Port 1455 occupied (Codex CLI listener left running) | medium | Distinct, actionable connect error naming the port and the likely culprit |
| Token leakage | low by construction | Tokens only in the SecretStore (OS keychain); never in DB, logs, error text, API responses, or fixtures; redact-before-truncate on every transport snippet; grep-verification step in validation |
| Plan quota mid-review | medium | Typed quota error with backend reset wording; **manual** one-click switch to a configured API key — never an automatic billing-path swap |
| Refresh token dies while user reviews | medium | Typed auth-expired error → "Reconnect ChatGPT in Setup" affordance; conversation history is unaffected (it's provider-independent) |
| `store:false` reasoning continuity breaks tool loops | low | `include: ["reasoning.encrypted_content"]` injected in the rewrite; provider round-trips `reasoningEncryptedContent` (verified in our installed `@ai-sdk/openai`); exercised by the mock E2E tool-call test |
| Model list drifts (plan gains/loses models) | medium | Curated short list; errors from unknown models pass through verbatim; list lives with the other curated tables |
| Multi-account confusion | low | coja is single-user/local; status shows the account email and plan, one connection only |

**UI disclosure**: the Setup row states plainly that this runs the AI panel on the
ChatGPT plan via the same sign-in the Codex CLI uses, and that an API key stays
available as a fallback; the model picker groups the models under
"ChatGPT (subscription)"; error messages name the billing path that failed and never
switch it silently.

## 6. Implementation plan

**Server — new module `server/src/codex/`** (network lives here, outside the AI layer,
whose invariant test forbids `fetch(` and network imports in `server/src/ai/**` —
`providers.ts` imports the factory from here the way it imports `createOpenAI`):

- `protocol.ts` — constants (client id, issuer, endpoints, port 1455, scope,
  client_version, refresh margin), all overridable for tests.
- `errors.ts` — `CodexError` base with stable `code`: `state_mismatch`,
  `auth_expired`, `quota`, `transport` (endpoint-change is a `transport` subtype),
  redaction helpers applied before truncation.
- `oauth.ts` — PKCE (S256, base64url), authorize-URL builder, token exchange, refresh,
  JWT metadata decode, loopback listener on `127.0.0.1:1455` (5-min deadline,
  state-validated, self-contained HTML, `/cancel`), terminal-error classification.
- `store.ts` — typed record (access/refresh/idToken/expiresAt/accountId/planType/email)
  in the existing `SecretStore` under `chatgpt-auth`; non-secret mirror
  (`email`, `plan`, connected-at) in the existing `settings` table for status reads;
  singleflight `getFreshAccessToken()` with reload-inside-promise and auth-expiry
  detection.
- `provider.ts` — `createCodexLanguageModel({ getFreshAccessToken, fetchImpl })`:
  `createOpenAI({ apiKey: unused, baseURL: https://chatgpt.com/backend-api/codex, fetch: wrapped }).responses(modelId)`;
  the wrapper does the §1.4 rewrite (fixed fields, unsupported-param deletion —
  `max_output_tokens` **must** go, our harness always sets it — `include` injection,
  `client_version` query, headers, session UUID), 401-retry-once, 429/401/non-2xx →
  typed errors, SSE collapse for `doGenerate`.

**Server — wiring (small edits):**

- `shared/api.ts` — `ProviderId` gains `'chatgpt'`; `PROVIDERS` stays the API-key
  list; new `SUBSCRIPTION_PROVIDERS = ['chatgpt']`; `SetupStatus` gains
  `chatgpt: { connected: boolean; email?: string; plan?: string }`; new routes
  `setupChatgptConnect` (POST → `{ ok, authUrl }`), `setupChatgptStatus`
  (GET → `{ status: 'idle'|'connecting'|'connected'|'error', error?, email?, plan? }`),
  `setupChatgptDisconnect` (DELETE).
- `routes/setup.ts` — the three routes + `modelsFor('chatgpt')` returning curated
  models when connected (no network); key routes keep `PROVIDERS` (keys only).
- `secrets/providers.ts` — `PROVIDER_LABELS.chatgpt = 'ChatGPT (subscription)'`,
  curated table for `chatgpt`.
- `ai/providers.ts` — `resolveLanguageModel` special-cases `chatgpt` (connection, not
  key); `defaultModelId` includes the subscription provider last.
- `services.ts` / `app.ts` — build the codex connection object once (owns store +
  singleflight + connect flow), hand it to setup routes and the AI provider factory.
- Static invariant tests untouched and green: the six tools, the agent loop, and
  `routes/chat.ts` are byte-for-byte unchanged; the chat handler still only knows
  `LanguageModel`.

**Web — smallest surface (three self-contained insertions):**

- `api/hooks.ts` + `client` — three thin hooks for the new routes.
- `setup/SetupScreen.tsx` — one new `<ChatGptRow/>` checklist row: label + disclosure
  badge + disclosure sentence; Connect (opens `authUrl`, then polls status until
  connected/error, showing the account email + plan when connected) and Disconnect;
  the provider `<Select>` keeps only API-key providers.
- `pr/ai/ModelPicker.tsx` — provider label entry (`Record` exhaustiveness forces it).
- `pr/ai/MessageList.tsx` — typed-failure rendering: recognise the stable error
  markers, strip them from the displayed text, and add the actions (Reconnect → Setup
  link; **Switch to OpenAI API key** one-click that re-points the next message's model
  only when an OpenAI key is configured — offered, never automatic).

**Tests** (Vitest, mocked authorization server + mocked Codex backend on a local
`http.Server` via injected endpoints/fetch):

1. OAuth happy path: authorize URL shape (PKCE S256 vector from PROTOCOL.md), state
   validation, code exchange, record persisted to the (memory) secret store, mirror in
   settings, listener closed.
2. Failure paths: state mismatch, OAuth error param, token-endpoint 401/`invalid_grant`
   → auth-expired classification; 5xx/timeout → retryable, not auth-expired.
3. Refresh: within margin → singleflight (N concurrent callers, one HTTP refresh),
   reload-inside-promise, missing `refresh_token` retention.
4. Transport: body rewrite (fixed fields, dropped `max_output_tokens`/`temperature`/…,
   `store:false`, `stream:true`, `include`, `client_version`), headers, 401 → refresh +
   retry once → auth-expired on second 401, 429 → quota, HTML-500 → endpoint-changed,
   SSE streaming with a tool call round-trip through the real `@ai-sdk/openai`
   Responses provider against the mock backend, `doGenerate` collapse with empty
   `response.completed.output`.
5. Route tests: connect (starts flow, returns auth URL, rejects concurrent), status,
   disconnect (keychain + mirror gone); models list gated on connection; chat handler
   untouched (existing suite must not change).
6. Redaction: no token material in any thrown message.

**Phase C (human in the loop):** build, run, browser-drive Setup → Connect, **pause
for the user to approve in the opened browser page**, verify status + picker, run a
real chat with a tool call against the fixture PR, restart the server and continue the
conversation, Disconnect and grep the repo/logs/SQLite for token material.
