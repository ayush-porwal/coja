import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerContext } from '../context.js'
import { openDb } from '../db.js'
import { createFixture, type Fixture } from '../git/test-fixture.js'
import { API_ROUTES, type ApiError, type Project } from '../shared/api.js'
import { onApiError } from './http.js'
import { registerProjectRoutes } from './projects.js'

let fx: Fixture
let ctx: ServerContext
let app: Hono

beforeAll(async () => {
  fx = await createFixture()
  ctx = { dataDir: await mkdtemp(path.join(os.tmpdir(), 'coja-data-')), db: openDb(':memory:') }
  app = new Hono()
  app.onError(onApiError)
  registerProjectRoutes(app, ctx)
})

afterAll(async () => {
  ctx.db.close()
  await rm(ctx.dataDir, { recursive: true, force: true })
  await fx.cleanup()
})

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('project routes', () => {
  it('starts empty', async () => {
    const res = await app.request(API_ROUTES.projects)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('POST adds a local project and GET lists/returns it', async () => {
    const res = await app.request(API_ROUTES.projects, json({ kind: 'local', path: fx.localDir }))
    expect(res.status).toBe(200)
    const project = (await res.json()) as Project
    expect(project).toMatchObject({ kind: 'local', owner: 'acme', repo: 'widgets' })

    const list = (await (await app.request(API_ROUTES.projects)).json()) as Project[]
    expect(list).toEqual([project])

    const one = await app.request(API_ROUTES.project(project.id))
    expect(one.status).toBe(200)
    expect(await one.json()).toEqual(project)
  })

  it('POST is idempotent for the same path', async () => {
    const res = await app.request(API_ROUTES.projects, json({ kind: 'local', path: fx.localDir }))
    expect(res.status).toBe(200)
    expect(((await (await app.request(API_ROUTES.projects)).json()) as Project[]).length).toBe(1)
  })

  it('400s on malformed bodies', async () => {
    for (const body of [
      {},
      { kind: 'local' },
      { kind: 'clone', slug: '' },
      { kind: 'zip', path: 'x' },
    ]) {
      const res = await app.request(API_ROUTES.projects, json(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      const err = (await res.json()) as ApiError
      expect(err.code).toBe('bad_request')
      expect(err.error).toContain('invalid request')
    }
    const notJson = await app.request(API_ROUTES.projects, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    })
    expect(notJson.status).toBe(400)
  })

  it('400s when the path is not a GitHub-backed repository', async () => {
    const res = await app.request(API_ROUTES.projects, json({ kind: 'local', path: fx.root }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toContain('not a git repository')
    const bad = await app.request(API_ROUTES.projects, json({ kind: 'clone', slug: 'nope' }))
    expect(bad.status).toBe(400)
  })

  it('404s for unknown projects and DELETE removes', async () => {
    expect((await app.request(API_ROUTES.project('missing'))).status).toBe(404)
    const [project] = (await (await app.request(API_ROUTES.projects)).json()) as Project[]
    if (!project) throw new Error('expected a project')
    const del = await app.request(API_ROUTES.project(project.id), { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await del.json()).toEqual({ ok: true })
    expect((await app.request(API_ROUTES.project(project.id))).status).toBe(404)
    expect((await app.request(API_ROUTES.project(project.id), { method: 'DELETE' })).status).toBe(
      404,
    )
  })
})
