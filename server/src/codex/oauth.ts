import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { CodexError, redact } from './errors.js'
import { authorizeUrl, type CodexProtocol, redirectUri } from './protocol.js'

/**
 * The browser authorization-code flow against OpenAI's public Codex OAuth
 * client: PKCE + state, a loopback listener on the client's registered
 * redirect (127.0.0.1:1455), the token exchange, and refresh. There is no
 * client secret. The stored record and the singleflight refresh live in
 * connection.ts; this module is the wire-level part.
 */

// ---------------------------------------------------------------------------
// Stored record
// ---------------------------------------------------------------------------

/** One ChatGPT connection. Tokens are credentials: SecretStore only, never logs. */
export interface CodexAuthRecord {
  accessToken: string
  refreshToken: string
  idToken?: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** Unverified JWT metadata — routing header and display only. */
  accountId?: string
  planType?: string
  email?: string
  /** Epoch ms of a terminal refresh failure; set = require reauthentication. */
  authExpiredAt?: number
  authExpiredReason?: string
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
}

// ---------------------------------------------------------------------------
// PKCE + JWT metadata
// ---------------------------------------------------------------------------

export interface Pkce {
  verifier: string
  challenge: string
}

export const challengeFor = (verifier: string): string =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url')

export async function generatePkce(): Promise<Pkce> {
  const verifier = randomBytes(64).toString('base64url')
  return { verifier, challenge: challengeFor(verifier) }
}

export const generateState = (): string => randomBytes(32).toString('base64url')

/** Unverified JWT payload decode — metadata only, never an auth check. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  const payload = parts.length === 3 ? parts[1] : undefined
  if (payload === undefined) return undefined
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

interface OpenAiAuthClaims {
  chatgpt_account_id?: string
  chatgpt_plan_type?: string
}

function authClaims(payload: Record<string, unknown> | undefined): OpenAiAuthClaims {
  const claims = payload?.['https://api.openai.com/auth']
  return typeof claims === 'object' && claims !== null ? (claims as OpenAiAuthClaims) : {}
}

/**
 * Account id and plan from `id_token`, falling back to the access token.
 * Values are unverified metadata: they route requests and label the UI, and
 * nothing authorizes on them.
 */
export function extractMetadata(tokens: Pick<TokenResponse, 'access_token' | 'id_token'>): {
  accountId?: string
  planType?: string
  email?: string
} {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue
    const payload = decodeJwtPayload(token)
    const claims = authClaims(payload)
    const accountId =
      claims.chatgpt_account_id ??
      (typeof payload?.chatgpt_account_id === 'string' ? payload.chatgpt_account_id : undefined)
    if (accountId) {
      return {
        accountId,
        ...(claims.chatgpt_plan_type ? { planType: claims.chatgpt_plan_type } : {}),
        ...(typeof payload?.email === 'string' ? { email: payload.email } : {}),
      }
    }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenEndpointDeps {
  fetchImpl: typeof fetch
  protocol: CodexProtocol
}

export async function exchangeCode(
  deps: TokenEndpointDeps,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: deps.protocol.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(deps.protocol),
  })
  return tokenRequest(deps, body)
}

export async function refreshAccessToken(
  deps: TokenEndpointDeps,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: deps.protocol.clientId,
    refresh_token: refreshToken,
    scope: deps.protocol.scope,
  })
  return tokenRequest(deps, body)
}

async function tokenRequest(
  deps: TokenEndpointDeps,
  body: URLSearchParams,
): Promise<TokenResponse> {
  let res: Response
  try {
    res = await deps.fetchImpl(`${deps.protocol.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    // Timeouts and DNS failures are retryable — never an auth-expiry signal.
    throw new CodexError('transport', redact(err instanceof Error ? err.message : String(err)))
  }
  if (!res.ok) {
    const detail = await errorDetail(res, deps.protocol)
    // OAuth error codes and bare 401/403 mean this credential generation is dead.
    if (
      res.status === 401 ||
      res.status === 403 ||
      detail.oauthError === 'invalid_grant' ||
      detail.oauthError === 'invalid_token' ||
      detail.oauthError === 'invalid_request'
    ) {
      throw new CodexError('auth_expired', detail.oauthError ?? `HTTP ${res.status}`)
    }
    throw new CodexError('transport', `HTTP ${res.status}${detail.snippet}`)
  }
  const parsed = (await res.json().catch(() => undefined)) as Partial<TokenResponse> | undefined
  if (!parsed?.access_token || typeof parsed.expires_in !== 'number') {
    throw new CodexError('transport', 'token endpoint returned an unexpected body')
  }
  return parsed as TokenResponse
}

/** Bounded, redacted body preview plus a parsed OAuth `error` code when present. */
async function errorDetail(
  res: Response,
  _protocol: CodexProtocol,
): Promise<{ oauthError?: string; snippet?: string }> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    return {}
  }
  let oauthError: string | undefined
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') oauthError = parsed.error
  } catch {
    // not JSON — the snippet below is still useful
  }
  // Redact first, truncate second: a token spanning the cut must not leak.
  const snippet = text ? `: ${redact(text).slice(0, 512)}` : ''
  return { ...(oauthError ? { oauthError } : {}), ...(snippet ? { snippet } : {}) }
}

// ---------------------------------------------------------------------------
// Loopback browser flow
// ---------------------------------------------------------------------------

export interface BrowserFlow {
  /** Open this in the user's browser. */
  authUrl: string
  /** Resolves with the exchanged tokens; rejects with CodexError. */
  completion: Promise<TokenResponse>
  /** Stop listening and reject a still-pending completion. */
  cancel(reason: string): void
}

/**
 * Start one authorization flow: bind 127.0.0.1:<redirectPort>, build the
 * authorize URL, and wait for exactly one callback. `openBrowser` is invoked
 * once the listener is accepting (errors there are not fatal — the URL is
 * shown in the UI too).
 */
export async function startBrowserFlow(deps: {
  protocol: CodexProtocol
  fetchImpl: typeof fetch
  openBrowser?: (url: string) => void
}): Promise<BrowserFlow> {
  const { protocol, fetchImpl } = deps
  const { verifier, challenge } = await generatePkce()
  const state = generateState()
  const authUrl = authorizeUrl(protocol, challenge, state)

  let resolveCompletion: ((tokens: TokenResponse) => void) | undefined
  let rejectCompletion: ((err: Error) => void) | undefined
  const completion = new Promise<TokenResponse>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  let server: Server
  try {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${protocol.redirectPort}`)
      if (url.pathname === protocol.redirectPath) {
        finish(url, res)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    })
  } catch (err) {
    throw new CodexError(
      'transport',
      `could not start the sign-in callback server (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const shutdown = () => {
    clearTimeout(timer)
    server.close()
  }
  const rejectPending = (err: CodexError) => {
    shutdown()
    rejectCompletion?.(err)
  }

  const finish = (url: URL, res: ServerResponse): void => {
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state') ?? ''

    let failure: CodexError | undefined
    if (error) {
      failure = new CodexError('transport', `authorization was refused: ${error}`)
    } else if (returnedState.length !== state.length || returnedState !== state) {
      // Byte-compare over the full length; a mismatch is a CSRF attempt or a stale tab.
      failure = new CodexError('state_mismatch')
    } else if (!code) {
      failure = new CodexError('transport', 'the sign-in callback carried no authorization code')
    }
    shutdown()
    if (failure || !code) {
      respondHtml(res, false)
      rejectCompletion?.(failure ?? new CodexError('transport', 'the callback carried no code'))
      return
    }

    respondHtml(res, true)
    exchangeCode({ fetchImpl, protocol }, code, verifier).then(resolveCompletion, (err: Error) => {
      clearTimeout(timer)
      rejectCompletion?.(err)
    })
  }

  const timer = setTimeout(
    () => rejectPending(new CodexError('transport', 'the sign-in window timed out')),
    protocol.authTimeoutMs,
  )

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new CodexError(
              'transport',
              `port ${protocol.redirectPort} is already in use — close whatever holds it` +
                ' (often the Codex CLI) and retry',
            )
          : new CodexError('transport', err.message),
      )
    })
    server.listen(protocol.redirectPort, '127.0.0.1', resolve)
  })

  deps.openBrowser?.(authUrl)
  return {
    authUrl,
    completion,
    cancel: (reason: string) => rejectPending(new CodexError('transport', reason)),
  }
}

/** Small self-contained page; callback values are never interpolated into it. */
function respondHtml(res: ServerResponse, ok: boolean): void {
  const body = `<!doctype html><meta charset="utf-8"><title>coja</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p style="max-width:28rem;text-align:center;line-height:1.5">${ok ? 'ChatGPT connected. You can close this tab and return to coja.' : 'The ChatGPT sign-in did not complete. Return to coja and try again.'}</p>`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** One shared session id per provider instance, as the backend expects. */
export const newSessionId = (): string => randomUUID()
