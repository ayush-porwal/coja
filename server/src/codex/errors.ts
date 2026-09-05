import {
  CHATGPT_MARKER_PATTERN,
  CHATGPT_MARKER_PREFIX,
  type ChatGptErrorCode,
  markChatGptError,
} from '../shared/api.js'

/**
 * Typed failures of the ChatGPT subscription path. Every error carries a
 * stable `code` (classification is never done by matching message text), and
 * its message is written for the reviewer — it may be shown in the chat panel
 * verbatim, so it names what happened and what to do, never token material.
 *
 * The message self-marks with the `[coja:chatgpt:<code>]` marker: chat-turn
 * errors reach the browser as bare strings (the AI SDK stream carries error
 * text only), and the marker is how the chat panel recognises a subscription
 * failure and offers reconnect / API-key actions without the chat handler
 * knowing anything about billing paths.
 */

const HEADINGS: Record<ChatGptErrorCode, string> = {
  state_mismatch: 'The ChatGPT sign-in could not be verified. Start it again.',
  auth_expired: 'Your ChatGPT sign-in has expired. Reconnect ChatGPT in Setup.',
  quota: 'Your ChatGPT plan limit is reached.',
  endpoint_changed:
    'The ChatGPT subscription backend refused the request. Use your OpenAI API key, and check for a coja update if this keeps happening.',
  transport: 'Could not reach the ChatGPT subscription backend.',
}

export class CodexError extends Error {
  constructor(
    readonly code: ChatGptErrorCode,
    detail?: string,
    readonly extra?: { retryAfterMs?: number },
  ) {
    const heading = HEADINGS[code]
    super(markChatGptError(code, detail ? `${heading} (${detail})` : heading))
    this.name = 'CodexError'
  }
}

export { CHATGPT_MARKER_PATTERN, CHATGPT_MARKER_PREFIX }

/**
 * Redact token material before truncation (PROTOCOL.md §10): a bearer header
 * or a JSON/form field carrying a token never survives into a thrown message
 * or log line.
 */
export function redact(text: string): string {
  let out = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
  for (const field of ['access_token', 'refresh_token', 'id_token', 'authorization']) {
    out = redactFormValue(out, field)
    out = redactJsonValue(out, field)
  }
  return out
}

function redactFormValue(text: string, field: string): string {
  // `field=<value>` up to a `&` (form body) with optional URL encoding.
  return text.replace(new RegExp(`${field}=[^&\\s"']*`, 'gi'), `${field}=[REDACTED]`)
}

function redactJsonValue(text: string, field: string): string {
  return text.replace(new RegExp(`"${field}"\\s*:\\s*"[^"]*"`, 'gi'), `"${field}":"[REDACTED]"`)
}
