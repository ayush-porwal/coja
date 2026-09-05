/**
 * Wire constants for the "Sign in with ChatGPT" provider
 * (docs/research/chatgpt-subscription-auth.md). These ride OpenAI's public
 * Codex CLI OAuth client against the undocumented ChatGPT Codex backend;
 * every value is overridable so tests can point at a local mock.
 */

export interface CodexProtocol {
  /** Public OAuth client of the Codex CLI — no secret exists for it. */
  clientId: string
  issuer: string
  /** The client's registered loopback redirect; the port is fixed by the registration. */
  redirectPort: number
  redirectPath: string
  scope: string
  responsesUrl: string
  /** The backend 400s on /responses without this query parameter. */
  clientVersion: string
  /** Refresh when `expiresAt - now` is below this. */
  refreshMarginMs: number
  /** Overall deadline for the loopback authorization flow. */
  authTimeoutMs: number
}

export const CODEX_PROTOCOL: CodexProtocol = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  redirectPort: 1455,
  redirectPath: '/auth/callback',
  scope: 'openid profile email offline_access',
  responsesUrl: 'https://chatgpt.com/backend-api/codex/responses',
  clientVersion: '0.144.6',
  refreshMarginMs: 120_000,
  authTimeoutMs: 5 * 60_000,
}

/** Parameters the Codex backend answers with `400 Unsupported parameter` (naming only the first). */
export const UNSUPPORTED_BODY_PARAMETERS = [
  'frequency_penalty',
  'logit_bias',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'presence_penalty',
  'safety_identifier',
  'seed',
  'stream_options',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
] as const

export function authorizeUrl(protocol: CodexProtocol, challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: protocol.clientId,
    redirect_uri: redirectUri(protocol),
    scope: protocol.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  })
  return `${protocol.issuer}/oauth/authorize?${params.toString()}`
}

export const redirectUri = (protocol: CodexProtocol): string =>
  `http://localhost:${protocol.redirectPort}${protocol.redirectPath}`
