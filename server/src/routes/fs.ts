import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Hono } from 'hono'
import { API_ROUTES, type DirEntry, type DirListing } from '../shared/api.js'
import { badRequest, notFound } from './http.js'

/**
 * Read-only filesystem browsing for the Add-project path picker (design.md §2).
 * Names of subdirectories only — never file listings, contents, or a disk-wide
 * search — capped and prefix-filtered so a huge directory costs the same as a
 * small one. The request guard already confines the app to loopback; this adds
 * no capability a local user lacks, and the picker only ever *suggests* paths
 * (adding one still validates that it is a git clone with an origin remote).
 */

/** Hard ceiling for one listing; the picker asks for no more than this. */
export const FS_LIST_CAP = 500

export function registerFsRoutes(app: Hono): void {
  app.get(API_ROUTES.fsHome, (c) => c.json({ home: os.homedir() }))

  app.get(API_ROUTES.fsDirs, async (c) => {
    const raw = c.req.query('path') ?? ''
    if (!raw.startsWith('/')) throw badRequest('path must be an absolute path')
    const prefix = (c.req.query('prefix') ?? '').toLowerCase()
    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), FS_LIST_CAP)
      : FS_LIST_CAP

    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(raw, { withFileTypes: true, encoding: 'utf8' })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw notFound(`directory ${raw}`)
      if (code === 'ENOTDIR') throw badRequest(`${raw} is not a directory`)
      if (code === 'EACCES') throw badRequest(`${raw} is not readable`)
      throw err
    }

    const names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
      .filter((name) => (prefix ? name.toLowerCase().startsWith(prefix) : true))

    const slice = names.slice(0, limit)
    // One stat per listed entry, capped: a `.git` entry (directory, file for
    // worktrees/submodules) marks a likely clone worth a badge in the picker.
    const dirs: DirEntry[] = await Promise.all(
      slice.map(async (name) => {
        const hasGit = await stat(path.join(raw, name, '.git'))
          .then(() => true)
          .catch(() => false)
        return { name, hasGit }
      }),
    )

    const parent = path.dirname(raw)
    const body: DirListing = {
      path: raw,
      parent: parent === raw ? null : parent,
      dirs,
      total: names.length,
      truncated: names.length > slice.length,
    }
    return c.json<DirListing>(body)
  })
}
