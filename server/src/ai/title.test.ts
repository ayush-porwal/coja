import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Db, openDb } from '../db.js'
import { insertProject } from '../projects/store.js'
import { createChat, deriveTitle, getChat, saveMessages } from './chats.js'
import { applyGeneratedTitle, generateTitle } from './title.js'
import type { ChatMessage } from './types.js'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

/** A non-streaming model that answers with `text`. */
function textGenerateModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  })
}

const user = (text: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text }],
})
const assistant = (text: string): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'step-start' }, { type: 'text', text }],
})

let db: Db
let projectId: string

beforeEach(() => {
  db = openDb(':memory:')
  projectId = insertProject(db, {
    kind: 'local',
    owner: 'acme',
    repo: 'widgets',
    path: '/tmp/widgets',
  }).id
})

afterEach(() => {
  db.close()
})

describe('generateTitle', () => {
  it('asks the model for a short name and cleans the reply', async () => {
    const model = textGenerateModel('  "Greeting renamed".\n')
    const title = await generateTitle(model, [
      user('Why did this change?'),
      assistant('The greeting changed to HELLO at src/app.ts:2.'),
    ])
    expect(title).toBe('Greeting renamed')
  })

  it('caps the title at TITLE_MAX_CHARS', async () => {
    const long = 'A'.repeat(200)
    const title = await generateTitle(textGenerateModel(long), [
      user('q'),
      assistant('a'.repeat(50)),
    ])
    expect(title?.length).toBeLessThanOrEqual(80)
  })

  it('returns null when the turn has no answer text (aborted or failed)', async () => {
    const spy = vi.fn()
    const model = new MockLanguageModelV4({ doGenerate: spy })
    const title = await generateTitle(model, [user('Why did this change?')])
    expect(title).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null when the model call fails', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('provider down')
      },
    })
    const title = await generateTitle(model, [user('q'), assistant('a full answer here')])
    expect(title).toBeNull()
  })
})

describe('applyGeneratedTitle', () => {
  it('replaces exactly the derived fallback title of this conversation', () => {
    const chat = createChat(db, { projectId, prNumber: 7, model: 'openai:gpt-5-mini' })
    const messages = [user('Why did this change?'), assistant('Because the test asserted HELLO.')]
    saveMessages(db, chat.id, messages)
    const fallback = deriveTitle(messages)
    expect(getChat(db, chat.id)?.chat.title).toBe(fallback)

    expect(applyGeneratedTitle(db, chat.id, 'Greeting renamed', fallback)).toBe(true)
    expect(getChat(db, chat.id)?.chat.title).toBe('Greeting renamed')
  })

  it('keeps the fallback when the model produced nothing', () => {
    const chat = createChat(db, { projectId, prNumber: 7, model: 'openai:gpt-5-mini' })
    const messages = [user('Why did this change?'), assistant('Because the test asserted HELLO.')]
    saveMessages(db, chat.id, messages)
    const before = getChat(db, chat.id)?.chat.title

    expect(applyGeneratedTitle(db, chat.id, null, deriveTitle(messages))).toBe(false)
    expect(getChat(db, chat.id)?.chat.title).toBe(before)
  })

  it('never overwrites a title that has moved on from the fallback', () => {
    const chat = createChat(db, { projectId, prNumber: 7, model: 'openai:gpt-5-mini' })
    saveMessages(db, chat.id, [user('q?'), assistant('an answer long enough here')])
    // A newer turn changed the stored title away from the old fallback.
    db.prepare('UPDATE chats SET title = ? WHERE id = ?').run('Manually chosen', chat.id)

    expect(applyGeneratedTitle(db, chat.id, 'Late model title', 'stale fallback')).toBe(false)
    expect(getChat(db, chat.id)?.chat.title).toBe('Manually chosen')
  })
})
