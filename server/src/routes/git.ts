import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import type { Forge } from '../forge/forge.js'
import type { PrFetcher } from '../pr/fetcher.js'
import { getBlob, getChangedFiles, getFileDiff } from '../pr/objects.js'
import { getProject } from '../projects/store.js'
import type {
  BlobResponse,
  FetchStatus,
  FileDiffResponse,
  GitChangedFile,
  Project,
} from '../shared/api.js'
import { badRequest, HttpError, notFound } from './http.js'
import { validate } from './projects.js'

export interface GitRouteDeps {
  forge: Forge
  fetcher: PrFetcher
}

const PR = '/api/projects/:projectId/prs/:number'

const DiffQuery = z.object({
  path: z.string().min(1),
  previousPath: z.string().min(1).optional(),
})

const BlobQuery = z.object({
  ref: z.enum(['base', 'head']).default('head'),
  path: z.string().min(1),
  start: z.coerce.number().int().min(1).optional(),
  end: z.coerce.number().int().min(1).optional(),
})

/**
 * `API_ROUTES.prFetch`, `prGitFiles`, `prDiff`, `prBlob`: the git side of a
 * pull request. Everything but `fetch` answers 409 (`code: 'git'`) until the
 * PR's objects are fetched; the UI polls `GET …/fetch` meanwhile.
 */
export function registerGitRoutes(app: Hono, ctx: ServerContext, deps: GitRouteDeps): void {
  const { forge, fetcher } = deps

  const load = (c: Context): { project: Project; number: number } => {
    const project = getProject(ctx.db, c.req.param('projectId') ?? '')
    if (!project) throw notFound('project')
    return { project, number: parsePrNumber(c.req.param('number')) }
  }

  const requireReady = (project: Project, number: number) => {
    const status = fetcher.status(project.id, number)
    if (status.state === 'ready' && status.headOid && status.baseOid && status.mergeBaseOid) {
      return { headOid: status.headOid, baseOid: status.baseOid, mergeBaseOid: status.mergeBaseOid }
    }
    const reason =
      status.state === 'error'
        ? `fetching PR #${number} failed: ${status.error ?? 'unknown error'}`
        : `PR #${number} is not fetched yet (${status.state}); POST …/fetch first`
    throw new HttpError(409, reason, 'git')
  }

  app.post(`${PR}/fetch`, async (c) => {
    const { project, number } = load(c)
    const refs = await forge.getPullRequestRefs(
      { owner: project.owner, repo: project.repo },
      number,
    )
    return c.json<FetchStatus>(await fetcher.ensure(project, refs))
  })

  app.get(`${PR}/fetch`, (c) => {
    const { project, number } = load(c)
    return c.json<FetchStatus>(fetcher.status(project.id, number))
  })

  app.get(`${PR}/git-files`, async (c) => {
    const { project, number } = load(c)
    const { mergeBaseOid, headOid } = requireReady(project, number)
    return c.json<GitChangedFile[]>(await getChangedFiles(project.path, mergeBaseOid, headOid))
  })

  app.get(`${PR}/diff`, async (c) => {
    const { project, number } = load(c)
    const query = validate(DiffQuery, c.req.query())
    const { mergeBaseOid, headOid } = requireReady(project, number)
    return c.json<FileDiffResponse>(
      await getFileDiff(project.path, mergeBaseOid, headOid, query.path, query.previousPath),
    )
  })

  app.get(`${PR}/blob`, async (c) => {
    const { project, number } = load(c)
    const query = validate(BlobQuery, c.req.query())
    const ready = requireReady(project, number)
    // `base` is the merge base: the commit the diff's left side shows.
    const oid = query.ref === 'head' ? ready.headOid : ready.mergeBaseOid
    return c.json<BlobResponse>(
      await getBlob(project.path, query.ref, oid, query.path, query.start, query.end),
    )
  })
}

function parsePrNumber(raw: string | undefined): number {
  const n = Number(raw)
  if (raw === undefined || !/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n <= 0) {
    throw badRequest(`invalid pull request number: ${raw ?? ''}`)
  }
  return n
}
