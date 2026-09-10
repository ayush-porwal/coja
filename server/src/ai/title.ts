import type { Db } from '../db.js'

export { generateTitle } from '@coja/agent'

/**
 * Store the generated title, but only while the chat still carries the derived
 * fallback for this exact conversation — a title a user (or a newer turn) has
 * set is never overwritten.
 */
export function applyGeneratedTitle(
  db: Db,
  chatId: string,
  generated: string | null,
  fallback: string | null,
): boolean {
  if (generated === null) return false
  const res = db
    .prepare('UPDATE chats SET title = ? WHERE id = ? AND title = ?')
    .run(generated, chatId, fallback)
  return Number(res.changes) > 0
}
