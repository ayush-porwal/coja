import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

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
})
