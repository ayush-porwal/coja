import type { InferUITools, UIMessage } from 'ai'
import { z } from 'zod'
import type { ChatDataParts, ChatMessageMetadata, ContextChip } from '../shared/api.js'
import type { createReviewTools } from './tools.js'

/**
 * The chat's message type and the schemas that validate what the browser
 * sends. The message shape is the Vercel AI SDK `UIMessage`, specialised with
 * the wire types from shared/api.ts (metadata, `data-chip` parts) and the
 * typed tool parts of the six review tools.
 */

export type ReviewTools = ReturnType<typeof createReviewTools>

/** `tool-read_file`, `tool-grep`, … parts with typed input and output. */
export type ReviewToolsUI = InferUITools<ReviewTools>

export type ChatMessage = UIMessage<ChatMessageMetadata, ChatDataParts, ReviewToolsUI>

/** A selection the user attached to a message (`{ type: 'data-chip', data: ContextChip }`). */
export const contextChipSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('selection'),
  path: z.string().min(1),
  ref: z.enum(['base', 'head']),
  side: z.enum(['LEFT', 'RIGHT']),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  text: z.string(),
}) satisfies z.ZodType<ContextChip>

/**
 * `.optional()` matters: `validateUIMessages` checks every message's metadata
 * against this, including messages the client sends without any.
 */
export const chatMessageMetadataSchema = z
  .object({
    model: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .optional() satisfies z.ZodType<ChatMessageMetadata | undefined>
