import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { handleChatTurn } from './chat-handler.js'
import type { ReviewDetail } from './contracts.js'
import { HarnessInputError } from './errors.js'
import type { RepositoryReader } from './repository.js'
import { createReviewTools } from './tools.js'

function repository(): RepositoryReader {
  return {
    blobInfo: vi.fn(async () => ({ exists: true, type: 'blob' as const, size: 6, oid: 'head' })),
    showFile: vi.fn(async () => ({ text: 'hello\n', binary: false, size: 6, truncated: false })),
    countLines: vi.fn(async () => 1),
    lsTree: vi.fn(async () => []),
    grep: vi.fn(async () => ({ matches: [], truncated: false })),
    diff: vi.fn(async () => ({ patch: '', truncated: false })),
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
  }
}
const detail: ReviewDetail = {
  number: 1,
  title: 'A change',
  isDraft: false,
  author: { login: 'alice' },
  headRefName: 'feature',
  baseRefName: 'main',
  commits: [],
  changedFiles: 0,
  additions: 0,
  deletions: 0,
  body: '',
  files: [],
}
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

describe('standalone harness', () => {
  it('reads through an injected repository without a checkout or database', async () => {
    const git = repository()
    const tools = createReviewTools({
      git,
      repo: 'memory',
      headOid: 'head',
      baseOid: 'base',
      files: [],
    })
    const result = await tools.read_file.execute?.(
      { ref: 'base', path: 'hello.txt' },
      { toolCallId: 'read', messages: [], context: {} },
    )
    expect(git.showFile).toHaveBeenCalledWith('memory', 'base', 'hello.txt', expect.anything())
    expect(result).toMatchObject({ content: '   1│ hello', ref: 'base' })
  })

  it('streams a response and returns the complete history to the host', async () => {
    const onFinish = vi.fn()
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'Review complete.' },
          { type: 'text-end', id: 'text' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
      },
    })
    const response = await handleChatTurn({
      chat: { id: 'chat' },
      model: 'test:model',
      languageModel: model,
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Review this.' }] }],
      toolContext: {
        git: repository(),
        repo: 'memory',
        headOid: 'head',
        baseOid: 'base',
        files: [],
      },
      detail,
      files: [],
      signal: new AbortController().signal,
      onFinish,
    })
    expect(await response.text()).toContain('Review complete.')
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFinish.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        parts: expect.arrayContaining([{ type: 'text', text: 'Review complete.', state: 'done' }]),
      }),
    ])
  })

  it('rejects malformed input before resolving a provider', async () => {
    const languageModel = vi.fn(async () => new MockLanguageModelV4())
    await expect(
      handleChatTurn({
        chat: { id: 'chat' },
        model: 'test:model',
        languageModel,
        messages: [],
        toolContext: {
          git: repository(),
          repo: 'memory',
          headOid: 'head',
          baseOid: 'base',
          files: [],
        },
        detail,
        files: [],
        signal: new AbortController().signal,
        onFinish: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(HarnessInputError)
    expect(languageModel).not.toHaveBeenCalled()
  })
})
