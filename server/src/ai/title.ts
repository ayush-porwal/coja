import { generateText, type LanguageModel } from 'ai'
import type { Db } from '../db.js'
import { TITLE_MAX_CHARS } from './chats.js'
import type { ChatMessage } from './types.js'

/**
 * The name of a first-turn chat: right after its first answer is persisted the
 * chat's own model is asked for a short title, replacing the first-user-text
 * fallback (which for a "Hello" opener is no title at all). Best-effort by
 * design — any failure keeps the fallback.
 */

/** Prompt budget for the conversation excerpt sent to the model. */
const EXCERPT_CHARS = 400

/** A non-answer turn (aborted, provider error) has no name-worthy content. */
const MIN_ASSISTANT_CHARS = 8

export async function generateTitle(
  model: LanguageModel,
  messages: readonly ChatMessage[],
): Promise<string | null> {
  const firstUser = firstText(messages, 'user')
  const firstAssistant = firstText(messages, 'assistant')
  if (firstAssistant === null || firstAssistant.length < MIN_ASSISTANT_CHARS) return null
  try {
    const { text } = await generateText({
      model,
      system:
        'You write ultra-short titles for code-review conversations. Reply with the title only: 2-6 words, no quotes, no trailing punctuation.',
      prompt: [
        'Name this conversation about a pull request.',
        `User: ${firstUser ?? '(reviewed a code selection)'}`,
        `Assistant: ${firstAssistant.slice(0, EXCERPT_CHARS)}`,
      ].join('\n'),
      // Reasoning models spend output on hidden thinking before the title;
      // too small a budget yields an empty text and the fallback stays.
      maxOutputTokens: 1024,
      abortSignal: AbortSignal.timeout(30_000),
    })
    return cleanTitle(text)
  } catch (err) {
    // The fallback title stays; the reason is still worth one log line.
    console.warn('coja: chat title generation failed:', err instanceof Error ? err.message : err)
    return null
  }
}

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

function firstText(messages: readonly ChatMessage[], role: 'user' | 'assistant'): string | null {
  for (const message of messages) {
    if (message.role !== role) continue
    for (const part of message.parts) {
      if (part.type !== 'text') continue
      const text = part.text.replace(/\s+/g, ' ').trim()
      if (text !== '') return text
    }
  }
  return null
}

function cleanTitle(text: string): string | null {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/^["'`“”*#\s]+|["'`“”*.\s]+$/g, '')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > TITLE_MAX_CHARS
    ? `${cleaned.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`
    : cleaned
}
