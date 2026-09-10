# Performance pass — 2026-09-08

## Changes and evidence

| Area | Before | After / verification |
| --- | --- | --- |
| Initial entry JavaScript | 1,615.80 kB minified / 463.40 kB gzip | 458.36 kB / 138.26 kB in the production build (about 72% / 70% smaller). The 1,163.52 kB review chunk loads separately. These are entry-bundle sizes, not total page-transfer or latency measurements. |
| Review navigation | Editor, highlighter, and chat shipped to every route | React.lazy loads the review route on demand. Hover/focus on a PR link preloads it; a direct review URL starts loading alongside the boot-status request. The themed fallback remains available. |
| Streaming chat | Every message body rendered on every update | Completed messages retain their render via React.memo. The SDK preserves older message identities. A regression fixture with 100 messages and 20 updates renders 20 bodies instead of 2,000; changed citation paths still update all messages. This measures render counts, not elapsed time. |
| Startup status | Provider key checks started after GitHub/ChatGPT checks finished | Independent checks start together. A test holds GitHub unresolved and verifies key lookups have already started. No additional stale auth cache is introduced. |
| Font/logo revalidation | Unhashed static files used no-cache without a validator, requiring a full response on reload | Weak file-metadata ETags allow 304 responses without reading the file body. Live HTTP check: MapleMono-NF-Regular.woff2 is 536,540 bytes on the first 200 response and zero body bytes on the next 304. Changed files return updated content; HTML retains CSP and security headers on revalidation. |

The existing diff viewer already virtualizes rows, caches parsed patches, and bounds diff fetch concurrency. Those mechanisms remain intact. This pass targets the additional startup, repeat-load, and streaming work identified in the current code rather than changing virtualizer geometry.

## Validation

- Full suite passed 782 tests across 80 files after these optimizations; typecheck and production build passed.
- Production browser verified Projects, direct review navigation, split diff rendering, and existing chat/tool/citation content. The PR list encountered an upstream GitHub HTTP 502 and displayed its retry state; no faster GitHub response is claimed.
- Repository-wide Biome passed after two formatting/import-order corrections in the concurrently edited PR-filter files. An unsupported Testing Library `exact` option in a new filter test was removed; its exact string-name matching is unchanged.
- Existing large-chunk and Lottie expression/eval build warnings remain. Route splitting reduces startup work; it does not reduce the review route's total dependency size or guarantee a particular wall-clock improvement on every machine.
