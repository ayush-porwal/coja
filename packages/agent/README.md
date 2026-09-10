# @coja/agent

A standalone, read-only code-review agent built on the Vercel AI SDK. It owns the
agent loop, six bounded review tools, system prompt, history pruning, message
validation, context selections, and title generation. It has no dependency on
coja's server, web app, database, routes, credentials, or git process runner.

## Entry points

- `@coja/agent`: server runtime, tools, title generation, and adapter types.
- `@coja/agent/client`: browser-safe message helpers, tool summaries, and types.
  Its runtime graph contains only local presentation helpers and tool names.
- `@coja/agent/contracts`: shared wire types, including `ContextChip`.
- `/tools`, `/types`, `/prompt`: focused exports for server integrations.

## Host integration

```ts
import { handleChatTurn, type RepositoryReader } from '@coja/agent'

const response = await handleChatTurn({
  chat: { id: chatId },
  messages,
  model: modelId,
  languageModel: () => resolveModel(modelId),
  toolContext: { git: repositoryReader, repo, headOid, baseOid, files },
  detail,
  files,
  signal: request.signal,
  onFinish: async (history) => {
    await persistMessages(chatId, history)
  },
})
```

The host supplies a `LanguageModel` or a lazy resolver, a `RepositoryReader`, and
an `onFinish` callback. Validation happens before the lazy model resolver runs.
The response uses the AI SDK UI message stream protocol. `onFinish` receives the
full history, including interrupted answers; only the model-facing history has
older tool output elided. The host must consume or return the response to drive
stream completion. Invalid conversations throw `HarnessInputError`; translate
that into the host's error format.

The repository adapter must validate paths and revisions and restrict operations
to read-only object access. Tool implementations bound output and restrict the
model's revision choice to the supplied head and base. Provider credentials,
network transport configuration, authentication, persistence, and title-update
concurrency belong to the host. `generateTitle` is available separately so the
host can save a fallback immediately and refine it without delaying streaming.

In coja, `server/src/ai/chat-handler.ts` composes the harness with provider
resolution and SQLite persistence, and `server/src/ai/tools.ts` adapts the git
plumbing. The web imports `/client`; shared API types re-export `/contracts`.

## Development

Run `pnpm install`, then `pnpm check` and `pnpm build` at the workspace root.
These commands build the harness before its consumers. `pnpm dev` watches all
three packages, including regenerated harness declarations and JavaScript.
To create a distributable tarball, run `pnpm --filter @coja/agent pack`.
Only compiled JavaScript, declarations, and this README are shipped. Publishing
this package is optional: the server build includes the compiled agent in
`server/dist/agent` and rewrites its imports to that shared local module graph.
The published CLI has no runtime dependency on an unpublished workspace package.
