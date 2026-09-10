import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY, createApp } from './app.js'

const INDEX_HTML = '<!doctype html><title>coja test shell</title>'

let publicDir: string

beforeAll(async () => {
  publicDir = await mkdtemp(path.join(tmpdir(), 'coja-public-'))
  await writeFile(path.join(publicDir, 'index.html'), INDEX_HTML)
  await mkdir(path.join(publicDir, 'assets'))
  await writeFile(path.join(publicDir, 'assets', 'app-abc123.js'), 'console.log("hi")')
})

afterAll(async () => {
  await rm(publicDir, { recursive: true, force: true })
})

describe('createApp', () => {
  it('revalidates unchanged fonts without a response body and notices replacements', async () => {
    const fontPath = path.join(publicDir, 'font.woff2')
    await writeFile(fontPath, 'font-version-one')
    const app = createApp({ publicDir })
    const first = await app.request('/font.woff2')
    const etag = first.headers.get('etag') ?? ''
    expect(etag).toMatch(/^W\//)
    const unchanged = await app.request('/font.woff2', {
      headers: { 'if-none-match': `"another", ${etag}` },
    })
    expect(unchanged.status).toBe(304)
    expect(await unchanged.text()).toBe('')
    expect(unchanged.headers.get('cache-control')).toBe('no-cache')
    expect(unchanged.headers.get('content-length')).toBeNull()
    await writeFile(fontPath, 'font-version-two-with-new-glyphs')
    const changed = await app.request('/font.woff2', { headers: { 'if-none-match': etag } })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
    expect(await changed.text()).toBe('font-version-two-with-new-glyphs')
  })

  it('preserves document security headers when the SPA shell is revalidated', async () => {
    const app = createApp({ publicDir })
    const first = await app.request('/some/route')
    const res = await app.request('/some/route', {
      headers: { 'if-none-match': first.headers.get('etag') ?? '' },
    })
    expect(res.status).toBe(304)
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('GET /api/health reports ok and the package version', async () => {
    const res = await createApp({ publicDir }).request('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { ok: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('returns index.html for unknown non-API routes (SPA fallback)', async () => {
    const res = await createApp({ publicDir }).request('/some/route')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toBe(INDEX_HTML)
  })

  it('serves / as index.html', async () => {
    const res = await createApp({ publicDir }).request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX_HTML)
  })

  it('serves existing assets as immutable', async () => {
    const res = await createApp({ publicDir }).request('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('console.log("hi")')
  })

  it('returns 404 for missing assets instead of the SPA shell', async () => {
    const res = await createApp({ publicDir }).request('/assets/x.js')
    expect(res.status).toBe(404)
  })

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await createApp({ publicDir }).request('/api/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('never serves files outside publicDir', async () => {
    // Encoded dot segments survive URL normalisation and are only revealed after decoding.
    const res = await createApp({ publicDir }).request('/%2e%2e/%2e%2e/etc/passwd')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX_HTML)
  })

  it('answers 503 with a hint when the UI has not been built', async () => {
    const res = await createApp({ publicDir: path.join(publicDir, 'missing') }).request('/')
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('pnpm build')
  })

  it('sends the Content-Security-Policy with the HTML document, direct and as the SPA fallback', async () => {
    const app = createApp({ publicDir })
    for (const route of ['/', '/index.html', '/some/route', '/%2e%2e/%2e%2e/etc/passwd']) {
      const res = await app.request(route)
      expect(res.status, route).toBe(200)
      expect(res.headers.get('content-security-policy'), route).toBe(CONTENT_SECURITY_POLICY)
    }
    // The policy itself: no inline or remote scripts, no framing, styles inline only, images pinned.
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'; script-src 'self'; ")
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe/)
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).toContain(
      "img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com",
    )
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("worker-src 'self' blob:")
    for (const directive of ['frame-ancestors', 'base-uri', 'form-action', 'object-src']) {
      expect(CONTENT_SECURITY_POLICY).toContain(`${directive} 'none'`)
    }
    // It governs the document only: assets and API responses carry none.
    expect(
      (await app.request('/assets/app-abc123.js')).headers.get('content-security-policy'),
    ).toBeNull()
    expect((await app.request('/api/health')).headers.get('content-security-policy')).toBeNull()
  })

  it('marks every response nosniff and no-referrer, refusals and errors included', async () => {
    const app = createApp({ publicDir })
    const responses: [string, Response][] = [
      ['index', await app.request('/')],
      ['fallback', await app.request('/some/route')],
      ['asset', await app.request('/assets/app-abc123.js')],
      ['api', await app.request('/api/health')],
      ['api 404', await app.request('/api/nope')],
      ['asset 404', await app.request('/assets/missing.js')],
      ['guard 403', await app.request('/api/health', { headers: { host: 'evil.example' } })],
      ['unbuilt 503', await createApp({ publicDir: path.join(publicDir, 'missing') }).request('/')],
    ]
    for (const [name, res] of responses) {
      expect(res.headers.get('x-content-type-options'), name).toBe('nosniff')
      expect(res.headers.get('referrer-policy'), name).toBe('no-referrer')
    }
    expect(responses.map(([, r]) => r.status)).toEqual([200, 200, 200, 200, 404, 404, 403, 503])
  })
})
