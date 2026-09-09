import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { getCustomProvider } from './custom-providers.js'
import { packageVersion } from './paths.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerFsRoutes } from './routes/fs.js'
import { registerGitRoutes } from './routes/git.js'
import { registerRequestGuard } from './routes/guard.js'
import { onApiError } from './routes/http.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerPullRoutes } from './routes/pulls.js'
import { registerReviewRoutes } from './routes/review.js'
import { registerSetupRoutes } from './routes/setup.js'
import type { AppServices } from './services.js'
import { API_ROUTES, type HealthResponse } from './shared/api.js'

export interface AppOptions {
  /** Directory holding the built web UI (`index.html` plus hashed files under `assets/`). */
  publicDir: string
  /** API backends. Omitted only by the static-serving tests. */
  services?: AppServices
  /** Extra hostnames accepted in the Host header (loopback is always allowed). */
  allowedHosts?: string[]
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

const NO_CACHE = 'no-cache'
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Policy for the HTML document. Model output is rendered as React elements,
 * never raw HTML; GitHub's `bodyHTML` is the one `dangerouslySetInnerHTML`, so
 * this is the second line of defence (docs/decisions.md). Scripts and styles
 * come from the Vite build; `'unsafe-inline'` is for styles only, because Shiki
 * tokens carry `style` attributes (@pierre/diffs uses constructed stylesheets,
 * which style-src does not govern, and its JS regex engine, so no wasm). Images
 * are avatars and GitHub's camo-proxied `bodyHTML` images, nothing else.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

export function createApp(opts: AppOptions) {
  const publicDir = path.resolve(opts.publicDir)
  const assetsDir = path.join(publicDir, 'assets') + path.sep
  const version = packageVersion()
  const app = new Hono()

  // First, so it wraps every response there is: the guard's refusals, error
  // bodies, API JSON and static files alike.
  app.use('*', async (c, next) => {
    await next()
    c.header('x-content-type-options', 'nosniff')
    c.header('referrer-policy', 'no-referrer')
  })

  // Host allow-list + cross-site request refusal: a web page on another origin
  // must never be able to drive this loopback API (see docs/decisions.md).
  registerRequestGuard(app, { allowedHosts: opts.allowedHosts })
  app.onError(onApiError)

  app.get(API_ROUTES.health, (c) => {
    const body: HealthResponse = { ok: true, version }
    return c.json(body)
  })

  if (opts.services) {
    const { ctx, forge, fetcher, secrets, ghAuthStatus, chatgpt } = opts.services
    registerSetupRoutes(app, ctx, { secrets, ghAuthStatus, chatgpt })
    registerFsRoutes(app)
    registerProjectRoutes(app, ctx)
    registerGitRoutes(app, ctx, { forge, fetcher })
    registerPullRoutes(app, ctx, { forge })
    registerReviewRoutes(app, ctx, { forge })
    // The AI layer gets a read-only PR reader, never the Forge (design: the AI drafts, the human sends).
    registerChatRoutes(app, ctx, {
      secrets,
      fetcher,
      subscription: chatgpt,
      customProviders: (id) => getCustomProvider(ctx.db, id),
      readPullRequest: (p, n) => forge.getPullRequest({ owner: p.owner, repo: p.repo }, n),
    })
  }

  // Unknown API routes are JSON 404s, never the SPA shell.
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  // Static UI with SPA fallback: a real file wins; otherwise index.html, except
  // under /assets/ where a miss is a genuine 404 (hashed files never fall back).
  app.get('*', async (c) => {
    const file = resolveUnder(publicDir, c.req.path)
    if (file) {
      const res = await serveFile(
        file,
        file.startsWith(assetsDir) ? IMMUTABLE : NO_CACHE,
        c.req.header('if-none-match'),
      )
      if (res) return res
    }
    if (c.req.path.startsWith('/assets/')) return c.text('not found', 404)

    const index = await serveFile(
      path.join(publicDir, 'index.html'),
      NO_CACHE,
      c.req.header('if-none-match'),
    )
    return (
      index ?? c.text('coja UI is not built. Run `pnpm build` (or use the Vite dev server).', 503)
    )
  })

  return app
}

/** Map a URL pathname onto a file inside `root`; null when malformed or escaping the root. */
function resolveUnder(root: string, pathname: string): string | null {
  // Hono already percent-decodes `c.req.path`; decoding again would turn an
  // encoded `%2F` into a separator. Containment below is the real guarantee.
  if (pathname.includes('\0')) return null
  const resolved = path.resolve(root, `.${pathname}`)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(prefix)) return null
  return resolved
}

/** Read `file` into a Response; null when it does not exist or is not a regular file. */
async function serveFile(
  file: string,
  cacheControl: string,
  ifNoneMatch?: string,
): Promise<Response | null> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(file)
    if (!info.isFile()) return null
  } catch {
    return null
  }
  const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': cacheControl,
    // Metadata validator avoids reading and transferring unchanged multi-MB
    // fonts. Weak because the validator describes file metadata, not a hash.
    etag: `W/"${info.size}-${info.mtimeMs}-${info.ctimeMs}"`,
  }
  // The document (served directly or as the SPA fallback) carries the policy; assets need none.
  if (type.startsWith('text/html')) headers['content-security-policy'] = CONTENT_SECURITY_POLICY
  const tag = headers.etag?.replace(/^W\//, '')
  if (
    ifNoneMatch?.split(',').some((value) => {
      const candidate = value.trim()
      return candidate === '*' || candidate.replace(/^W\//, '') === tag
    })
  ) {
    return new Response(null, { status: 304, headers })
  }
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    return null
  }
  headers['content-length'] = String(body.byteLength)
  return new Response(body, { headers })
}
