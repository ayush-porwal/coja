import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { packageVersion } from './paths.js'
import { registerGitRoutes } from './routes/git.js'
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

export function createApp(opts: AppOptions) {
  const publicDir = path.resolve(opts.publicDir)
  const assetsDir = path.join(publicDir, 'assets') + path.sep
  const version = packageVersion()
  const app = new Hono()

  app.onError(onApiError)

  app.get(API_ROUTES.health, (c) => {
    const body: HealthResponse = { ok: true, version }
    return c.json(body)
  })

  if (opts.services) {
    const { ctx, forge, fetcher, secrets, ghAuthStatus } = opts.services
    registerSetupRoutes(app, ctx, { secrets, ghAuthStatus })
    registerProjectRoutes(app, ctx)
    registerGitRoutes(app, ctx, { forge, fetcher })
    registerPullRoutes(app, ctx, { forge })
    registerReviewRoutes(app, ctx, { forge })
  }

  // Unknown API routes are JSON 404s, never the SPA shell.
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  // Static UI with SPA fallback: a real file wins; otherwise index.html, except
  // under /assets/ where a miss is a genuine 404 (hashed files never fall back).
  app.get('*', async (c) => {
    const file = resolveUnder(publicDir, c.req.path)
    if (file) {
      const res = await serveFile(file, file.startsWith(assetsDir) ? IMMUTABLE : NO_CACHE)
      if (res) return res
    }
    if (c.req.path.startsWith('/assets/')) return c.text('not found', 404)

    const index = await serveFile(path.join(publicDir, 'index.html'), NO_CACHE)
    return (
      index ?? c.text('coja UI is not built. Run `pnpm build` (or use the Vite dev server).', 503)
    )
  })

  return app
}

/** Map a URL pathname onto a file inside `root`; null when malformed or escaping the root. */
function resolveUnder(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const resolved = path.resolve(root, `.${decoded}`)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(prefix)) return null
  return resolved
}

/** Read `file` into a Response; null when it does not exist or is not a regular file. */
async function serveFile(file: string, cacheControl: string): Promise<Response | null> {
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    return null
  }
  return new Response(body, {
    headers: {
      'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': cacheControl,
    },
  })
}
