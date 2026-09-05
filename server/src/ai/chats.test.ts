import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Db, openDb } from '../db.js'
import { insertProject } from '../projects/store.js'
import type { ContextChip } from '../shared/api.js'
import {
  createChat,
  deleteChat,
  deriveTitle,
  getChat,
  listChats,
  saveMessages,
  TITLE_MAX_CHARS,
} from './chats.js'
import type { ChatMessage } from './types.js'

const T0 = '2026-09-05T10:00:00.000Z'
const MODEL = 'openai:gpt-5-mini'

let db: Db
let projectId: string

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(T0) })
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
  vi.useRealTimers()
})

const user = (text: string, id = 'u1'): ChatMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

const assistant = (text: string, id = 'a1'): ChatMessage => ({
  id,
  role: 'assistant',
  metadata: { model: MODEL, createdAt: T0 },
  parts: [{ type: 'step-start' }, { type: 'text', text, state: 'done' }],
})

const chip: ContextChip = {
  id: 'chip-1',
  kind: 'selection',
  path: 'src/app.ts',
  ref: 'head',
  side: 'RIGHT',
  startLine: 2,
  endLine: 2,
  text: "  const greeting = 'HELLO'",
}

const create = (prNumber = 7, model = MODEL) => createChat(db, { projectId, prNumber, model })

describe('chat store', () => {
  it('creates, gets and lists chats, most recently updated first', () => {
    const first = create()
    expect(first).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      projectId,
      prNumber: 7,
      title: null,
      model: MODEL,
      createdAt: T0,
      updatedAt: T0,
    })
    expect(getChat(db, first.id)).toEqual({ chat: first, messages: [] })

    vi.advanceTimersByTime(1000)
    const second = create(7, 'anthropic:claude-sonnet-4-5')
    create(8) // another PR of the same project
    expect(listChats(db, projectId, 7).map((c) => c.id)).toEqual([second.id, first.id])

    vi.advanceTimersByTime(1000)
    expect(saveMessages(db, first.id, [user('Why was the greeting changed?')])).toBe(true)
    expect(listChats(db, projectId, 7).map((c) => c.id)).toEqual([first.id, second.id])
    expect(getChat(db, first.id)).toEqual({
      chat: {
        ...first,
        title: 'Why was the greeting changed?',
        updatedAt: '2026-09-05T10:00:02.000Z',
      },
      messages: [user('Why was the greeting changed?')],
    })

    expect(listChats(db, projectId, 9)).toEqual([])
    expect(listChats(db, 'other-project', 7)).toEqual([])
    expect(getChat(db, 'missing')).toBeUndefined()
  })

  it('round-trips messages with chips, tool parts and metadata verbatim', () => {
    const chat = create()
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        metadata: { createdAt: T0 },
        parts: [
          { type: 'data-chip', id: chip.id, data: chip },
          { type: 'text', text: 'Why did this change?' },
        ],
      },
      {
        id: 'msg-1',
        role: 'assistant',
        metadata: { model: MODEL, createdAt: T0 },
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-grep',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { ref: 'head', pattern: 'HELLO' },
            output: {
              matches: [{ path: 'src/app.ts', line: 2, text: "  const greeting = 'HELLO'" }],
              truncated: false,
            },
          },
          { type: 'step-start' },
          { type: 'text', text: 'It is used at src/app.ts:2.', state: 'done' },
        ],
      },
    ]
    saveMessages(db, chat.id, messages, { model: MODEL })
    expect(getChat(db, chat.id)?.messages).toEqual(messages)
  })

  it('titles a chat once, from the first user text, trimmed to 80 characters', () => {
    const chat = create()
    const long = `${'word '.repeat(30)}end`
    saveMessages(db, chat.id, [user(`  ${long}  `)])
    const title = getChat(db, chat.id)?.chat.title
    expect(title?.length).toBeLessThanOrEqual(TITLE_MAX_CHARS)
    expect(title?.startsWith('word word word')).toBe(true)
    expect(title?.endsWith('…')).toBe(true)

    // Later saves keep the first title.
    saveMessages(db, chat.id, [user('edited question'), assistant('answer')])
    expect(getChat(db, chat.id)?.chat.title).toBe(title)

    // Chips and blank text parts are skipped; whitespace is collapsed.
    const withChip = create()
    saveMessages(db, withChip.id, [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'data-chip', id: chip.id, data: chip },
          { type: 'text', text: '   ' },
          { type: 'text', text: 'Explain\n  this   diff ' },
        ],
      },
    ])
    expect(getChat(db, withChip.id)?.chat.title).toBe('Explain this diff')

    // No user text yet: still untitled.
    const untitled = create()
    saveMessages(db, untitled.id, [assistant('hello')])
    expect(getChat(db, untitled.id)?.chat.title).toBeNull()

    expect(deriveTitle([])).toBeNull()
    expect(deriveTitle([user('x'.repeat(80))])).toBe('x'.repeat(80))
    expect(deriveTitle([user('x'.repeat(81))])?.length).toBe(80)
  })

  it('updates the model only when one is given and reports unknown ids', () => {
    const chat = create()
    saveMessages(db, chat.id, [user('q')])
    expect(getChat(db, chat.id)?.chat.model).toBe(MODEL)
    saveMessages(db, chat.id, [user('q')], { model: 'anthropic:claude-haiku-4-5' })
    expect(getChat(db, chat.id)?.chat.model).toBe('anthropic:claude-haiku-4-5')
    expect(saveMessages(db, 'missing', [user('q')])).toBe(false)
  })

  it('deletes chats, and loses them together with their project', () => {
    const chat = create()
    expect(deleteChat(db, chat.id)).toBe(true)
    expect(deleteChat(db, chat.id)).toBe(false)
    expect(getChat(db, chat.id)).toBeUndefined()

    const orphan = create()
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    expect(getChat(db, orphan.id)).toBeUndefined()
  })

  it('refuses chats for unknown projects', () => {
    expect(() => createChat(db, { projectId: 'nope', prNumber: 1, model: MODEL })).toThrow()
  })

  it('tolerates corrupt stored JSON instead of breaking the chat list', () => {
    const chat = create()
    db.prepare('UPDATE chats SET messages_json = ? WHERE id = ?').run('{not json', chat.id)
    expect(getChat(db, chat.id)?.messages).toEqual([])
    expect(listChats(db, projectId, 7)).toHaveLength(1)
  })
})
