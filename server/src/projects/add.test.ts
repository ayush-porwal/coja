import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerContext } from '../context.js'
import { openDb } from '../db.js'
import { isBareRepo } from '../git/plumbing.js'
import { GitError } from '../git/run.js'
import { createFixture, type Fixture } from '../git/test-fixture.js'
import { HttpError } from '../routes/http.js'
import { addCloneProject, addLocalProject, cloneDir, removeProject } from './add.js'
import { getProject, listProjects } from './store.js'

let fx: Fixture
let ctx: ServerContext

beforeAll(async () => {
  fx = await createFixture()
  ctx = { dataDir: await mkdtemp(path.join(os.tmpdir(), 'coja-data-')), db: openDb(':memory:') }
})

afterAll(async () => {
  ctx.db.close()
  await rm(ctx.dataDir, { recursive: true, force: true })
  await fx.cleanup()
})

const status = async (p: Promise<unknown>): Promise<HttpError> => {
  const err = await p.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(HttpError)
  return err as HttpError
}

describe('addLocalProject', () => {
  it('registers a clone whose origin is on GitHub, normalised to its top level', async () => {
    const project = await addLocalProject(ctx, path.join(fx.localDir, 'src'))
    expect(project).toMatchObject({ kind: 'local', owner: 'acme', repo: 'widgets' })
    expect(project.path).toBe(await realpath(fx.localDir))
    expect(getProject(ctx.db, project.id)).toEqual(project)
  })

  it('returns the existing project for the same path', async () => {
    const [existing] = listProjects(ctx.db)
    expect(await addLocalProject(ctx, fx.localDir)).toEqual(existing)
    expect(await addLocalProject(ctx, `${fx.localDir}/`)).toEqual(existing)
    expect(listProjects(ctx.db)).toHaveLength(1)
  })

  it('rejects paths that are not GitHub-backed git repositories', async () => {
    expect((await status(addLocalProject(ctx, path.join(fx.root, 'nope')))).message).toContain(
      'does not exist',
    )
    expect((await status(addLocalProject(ctx, fx.root))).message).toContain('not a git repository')
    // origin points at a local path, not github.com
    const err = await status(addLocalProject(ctx, fx.workDir))
    expect(err.status).toBe(400)
    expect(err.message).toContain('not a GitHub repository')
    expect((await status(addLocalProject(ctx, path.join(fx.localDir, 'README.md')))).status).toBe(
      400,
    )
  })

  it('rejects a repository without an origin remote', async () => {
    const bare = path.join(fx.root, 'no-origin.git')
    await fx.cloneBareLocal(bare)
    await fx.git(bare, ['remote', 'remove', 'origin'])
    const err = await status(addLocalProject(ctx, bare))
    expect(err.message).toContain('no "origin" remote')
  })
})

describe('addCloneProject', () => {
  it('clones into <dataDir>/repos/<owner>__<repo>.git and registers a clone project', async () => {
    const calls: string[] = []
    const project = await addCloneProject(ctx, 'Acme/Widgets', {
      clone: async (url, dir) => {
        calls.push(url)
        await fx.cloneBareLocal(dir)
      },
    })
    expect(calls).toEqual(['https://github.com/Acme/Widgets.git'])
    expect(project).toMatchObject({ kind: 'clone', owner: 'Acme', repo: 'Widgets' })
    expect(project.path).toBe(path.join(ctx.dataDir, 'repos', 'acme__widgets.git'))
    expect(project.path).toBe(cloneDir(ctx.dataDir, 'Acme', 'Widgets'))
    expect(await isBareRepo(project.path)).toBe(true)
  })

  it('is idempotent and reuses an existing directory without cloning again', async () => {
    const before = listProjects(ctx.db)
    const again = await addCloneProject(ctx, 'acme/widgets', {
      clone: async () => {
        throw new Error('should not clone')
      },
    })
    expect(before.map((p) => p.id)).toContain(again.id)
    expect(listProjects(ctx.db)).toHaveLength(before.length)
  })

  it('rejects bad slugs and cleans up after a failed clone', async () => {
    expect((await status(addCloneProject(ctx, 'not a slug'))).status).toBe(400)
    const err = await status(
      addCloneProject(ctx, 'acme/broken', {
        clone: async (_url, dir) => {
          await fx.cloneBareLocal(dir) // partial state that must be removed
          throw new GitError(['clone'], 128, 'fatal: boom', 'git clone failed (exit 128)')
        },
      }),
    )
    expect(err.message).toContain('boom')
    await expect(access(cloneDir(ctx.dataDir, 'acme', 'broken'))).rejects.toThrow()
    expect(listProjects(ctx.db).some((p) => p.repo === 'broken')).toBe(false)
  })
})

describe('removeProject', () => {
  it('deletes a clone project together with its bare directory', async () => {
    const project = listProjects(ctx.db).find((p) => p.kind === 'clone')
    if (!project) throw new Error('fixture: expected a clone project')
    await removeProject(ctx, project.id)
    expect(getProject(ctx.db, project.id)).toBeUndefined()
    await expect(access(project.path)).rejects.toThrow()
  })

  it('forgets a local project without touching its files', async () => {
    const project = listProjects(ctx.db).find((p) => p.kind === 'local')
    if (!project) throw new Error('fixture: expected a local project')
    await removeProject(ctx, project.id)
    expect(getProject(ctx.db, project.id)).toBeUndefined()
    await access(path.join(fx.localDir, '.git'))
    expect(await fx.git(fx.localDir, ['status', '--porcelain'])).toBe('')
  })

  it('404s for unknown ids', async () => {
    expect((await status(removeProject(ctx, 'nope'))).status).toBe(404)
  })
})
