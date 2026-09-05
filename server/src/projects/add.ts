import { mkdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerContext } from '../context.js'
import { cloneBare, isBareRepo, isGitRepo, remoteUrl, topLevel } from '../git/plumbing.js'
import { parseGitHubRemote, parseRepoSlug } from '../git/remote.js'
import { GitError } from '../git/run.js'
import { badRequest, HttpError, notFound } from '../routes/http.js'
import type { Project } from '../shared/api.js'
import { deleteProject, findProjectByPath, getProject, insertProject } from './store.js'

/**
 * Adding and removing projects (design.md, "Projects → PR list"): a `local`
 * project is the user's own clone, identified through its `origin` remote; a
 * `clone` project is a bare clone coja manages under `<dataDir>/repos/`.
 */

/** Register the git repository at `inputPath` (absolute, or `~`-relative) as a local project. */
export async function addLocalProject(ctx: ServerContext, inputPath: string): Promise<Project> {
  const resolved = resolveUserPath(inputPath)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolved)
  } catch {
    throw badRequest(`${resolved} does not exist`)
  }
  if (!info.isDirectory()) throw badRequest(`${resolved} is not a directory`)
  if (!(await isGitRepo(resolved))) throw badRequest(`${resolved} is not a git repository`)

  // Normalise to the working-tree root so the same clone is never registered twice.
  const repoPath = (await isBareRepo(resolved))
    ? resolved
    : ((await topLevel(resolved)) ?? resolved)
  const existing = findProjectByPath(ctx.db, repoPath)
  if (existing) return existing

  const url = await remoteUrl(repoPath, 'origin')
  if (!url) {
    throw badRequest(
      `${repoPath} has no "origin" remote; coja needs a GitHub remote to find its pull requests`,
    )
  }
  const gh = parseGitHubRemote(url)
  if (!gh)
    throw badRequest(`the "origin" remote of ${repoPath} is not a GitHub repository (${url})`)
  return insertProject(ctx.db, { kind: 'local', owner: gh.owner, repo: gh.repo, path: repoPath })
}

export interface CloneDeps {
  /** Injected by tests; defaults to {@link cloneBare}. */
  clone?: (url: string, dir: string) => Promise<void>
}

/** Clone `owner/repo` (or a github.com URL) bare into the data dir and register it. */
export async function addCloneProject(
  ctx: ServerContext,
  slug: string,
  deps: CloneDeps = {},
): Promise<Project> {
  const parsed = parseRepoSlug(slug)
  if (!parsed) {
    throw badRequest(
      `"${slug}" is not a GitHub repository (expected owner/repo or a github.com URL)`,
    )
  }
  const { owner, repo } = parsed
  const dir = cloneDir(ctx.dataDir, owner, repo)
  const existing = findProjectByPath(ctx.db, dir)
  if (existing) return existing

  if (!(await isGitRepo(dir))) {
    await mkdir(path.dirname(dir), { recursive: true })
    // A leftover from an interrupted clone would make `git clone` refuse the directory.
    await rm(dir, { recursive: true, force: true })
    try {
      await (deps.clone ?? cloneBare)(`https://github.com/${owner}/${repo}.git`, dir)
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      if (err instanceof GitError) {
        const detail = err.stderr.trim() || err.message
        throw new HttpError(400, `could not clone ${owner}/${repo}: ${detail}`, 'git')
      }
      throw err
    }
  }
  return insertProject(ctx.db, { kind: 'clone', owner, repo, path: dir })
}

/**
 * Forget a project. App-managed bare clones are deleted from disk (they are
 * ours); a local project's files are never touched.
 */
export async function removeProject(ctx: ServerContext, id: string): Promise<void> {
  const project = getProject(ctx.db, id)
  if (!project) throw notFound('project')
  deleteProject(ctx.db, id)
  if (project.kind === 'clone' && isInside(reposDir(ctx.dataDir), project.path)) {
    await rm(project.path, { recursive: true, force: true })
  }
}

export const reposDir = (dataDir: string): string => path.join(dataDir, 'repos')

/** `<dataDir>/repos/<owner>__<repo>.git`, lower-cased because GitHub slugs are case-insensitive. */
export function cloneDir(dataDir: string, owner: string, repo: string): string {
  return path.join(reposDir(dataDir), `${owner}__${repo}.git`.toLowerCase())
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.resolve(os.homedir(), trimmed.slice(2))
  return path.resolve(trimmed)
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
