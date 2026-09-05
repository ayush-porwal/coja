import { randomUUID } from 'node:crypto'
import { type Db, nowIso } from '../db.js'
import type { Chat } from '../shared/api.js'
import type { ChatMessage } from './types.js'

/**
 * Chat history in SQLite (`chats` table, db.ts) — the one thing GitHub cannot
 * hold for us. A row is one conversation about one PR; its messages are the
 * full Vercel AI SDK `UIMessage[]` as JSON, written wholesale when a turn
 * ends, so what the UI renders after a reload is exactly what it streamed.
 */

export const TITLE_MAX_CHARS = 80

interface Row {
  id: string
  project_id: string
  pr_number: number
  title: string | null
  model: string
  messages_json: string
  created_at: string
  updated_at: string
}

const CHAT_COLUMNS = 'id, project_id, pr_number, title, model, created_at, updated_at'

const toChat = (r: Row): Chat => ({
  id: r.id,
  projectId: r.project_id,
  prNumber: Number(r.pr_number),
  title: r.title,
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** Chats of one PR, most recently updated first. */
export function listChats(db: Db, projectId: string, prNumber: number): Chat[] {
  const rows = db
    .prepare(
      `SELECT ${CHAT_COLUMNS} FROM chats WHERE project_id = ? AND pr_number = ?
       ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(projectId, prNumber) as unknown as Row[]
  return rows.map(toChat)
}

export function createChat(
  db: Db,
  input: { projectId: string; prNumber: number; model: string },
): Chat {
  const now = nowIso()
  const chat: Chat = {
    id: randomUUID(),
    projectId: input.projectId,
    prNumber: input.prNumber,
    title: null,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  }
  db.prepare(
    `INSERT INTO chats (id, project_id, pr_number, title, model, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, '[]', ?, ?)`,
  ).run(chat.id, chat.projectId, chat.prNumber, chat.model, now, now)
  return chat
}

export function getChat(db: Db, id: string): { chat: Chat; messages: ChatMessage[] } | undefined {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as unknown as Row | undefined
  if (!row) return undefined
  return { chat: toChat(row), messages: parseMessages(row.messages_json) }
}

/**
 * Replace the stored conversation. Bumps `updated_at`, fills in the title from
 * the first user text (once — an existing title is kept) and records the model
 * when given. Returns false when no chat has that id.
 */
export function saveMessages(
  db: Db,
  id: string,
  messages: ChatMessage[],
  opts: { model?: string } = {},
): boolean {
  const res = db
    .prepare(
      `UPDATE chats
       SET messages_json = ?, updated_at = ?, title = COALESCE(title, ?), model = COALESCE(?, model)
       WHERE id = ?`,
    )
    .run(JSON.stringify(messages), nowIso(), deriveTitle(messages), opts.model ?? null, id)
  return Number(res.changes) > 0
}

export function deleteChat(db: Db, id: string): boolean {
  const res = db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  return Number(res.changes) > 0
}

/** The first user message's first non-blank text, whitespace collapsed, at most TITLE_MAX_CHARS characters. */
export function deriveTitle(messages: readonly ChatMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type !== 'text') continue
      const text = part.text.replace(/\s+/g, ' ').trim()
      if (text === '') continue
      return text.length > TITLE_MAX_CHARS
        ? `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`
        : text
    }
  }
  return null
}

function parseMessages(json: string): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}
