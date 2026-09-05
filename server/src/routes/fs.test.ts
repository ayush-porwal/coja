import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { API_ROUTES, type DirListing } from '../shared/api.js'
import { FS_LIST_CAP, registerFsRoutes } from './fs.js'
import { onApiError } from './http.js'

const app = new Hono()
app.onError(onApiError)
registerFsRoutes(app)

const dirs = async (query: string): Promise<Response> => app.request(`${API_ROUTES.fsDirs}${query}`)

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root)
  }
})

async function rm(dir: string): Promise<void> {
  // The test tree only contains dirs and tiny files, so rm -rf semantics via
  // Node's own helper keeps this readable.
  const { rm: rmrf } = await import('node:fs/promises')
  await rmrf(dir, { recursive: true, force: true })
}

async function makeTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'coja-fs-'))
  roots.push(root)
  await mkdir(path.join(root, 'subA', '.git'), { recursive: true })
  await mkdir(path.join(root, 'subB'))
  await mkdir(path.join(root, '.Hidden'), { recursive: true })
  await mkdir(path.join(root, 'SubC', '.git'), { recursive: true })
  await writeFile(path.join(root, 'file.txt'), 'not a directory')
  await writeFile(path.join(root, 'notes.md'), '# not a directory either')
  return root
}

describe('GET /api/fs/home', () => {
  it('returns the server user home', async () => {
    const res = await app.request(API_ROUTES.fsHome)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { home: string }
    expect(body.home.startsWith('/')).toBe(true)
  })
})

describe('GET /api/fs/dirs', () => {
  it('lists subdirectories only, sorted case-insensitively, with hasGit badges', async () => {
    const root = await makeTree()
    const res = await dirs(`?path=${encodeURIComponent(root)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as DirListing
    expect(body.path).toBe(root)
    expect(body.parent).toBe(path.dirname(root))
    expect(body.truncated).toBe(false)
    expect(body.total).toBe(4)
    expect(body.dirs.map((d) => d.name)).toEqual(['.Hidden', 'subA', 'subB', 'SubC'])
    expect(body.dirs.map((d) => d.hasGit)).toEqual([false, true, false, true])
  })

  it('filters by prefix case-insensitively', async () => {
    const root = await makeTree()
    const res = await dirs(`?path=${encodeURIComponent(root)}&prefix=SUB`)
    const body = (await res.json()) as DirListing
    expect(body.dirs.map((d) => d.name)).toEqual(['subA', 'subB', 'SubC'])
    expect(body.total).toBe(3)
  })

  it('caps the slice and reports truncation', async () => {
    const root = await makeTree()
    const res = await dirs(`?path=${encodeURIComponent(root)}&limit=2`)
    const body = (await res.json()) as DirListing
    expect(body.dirs).toHaveLength(2)
    expect(body.total).toBe(4)
    expect(body.truncated).toBe(true)
  })

  it('clamps the limit to the shared cap', async () => {
    const root = await makeTree()
    const res = await dirs(`?path=${encodeURIComponent(root)}&limit=99999`)
    const body = (await res.json()) as DirListing
    expect(body.dirs.length).toBe(Math.min(4, FS_LIST_CAP))
    expect(body.truncated).toBe(false)
  })

  it('answers 400 for a relative path and 404 for a missing one', async () => {
    expect((await dirs('?path=relative/path')).status).toBe(400)
    const missing = await dirs(`?path=${encodeURIComponent('/nonexistent/coja-fs-path')}`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toContain('not found')
  })

  it('answers 400 when the path is a file', async () => {
    const root = await makeTree()
    const res = await dirs(`?path=${encodeURIComponent(path.join(root, 'file.txt'))}`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('not a directory')
  })

  it('reports parent null only at the filesystem root', async () => {
    const root = await makeTree()
    const listing = (await (await dirs(`?path=${encodeURIComponent(root)}`)).json()) as DirListing
    expect(listing.parent).not.toBeNull()
    const atRoot = (await (await dirs('?path=/')).json()) as DirListing
    expect(atRoot.parent).toBeNull()
  })
})
