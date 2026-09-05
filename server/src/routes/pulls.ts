import type { Context, Hono } from 'hono'
import type { ServerContext } from '../context.js'
import type { Forge, RepoRef } from '../forge/forge.js'
import { getProject } from '../projects/store.js'
import type { Project, PullRequestDetail, PullRequestSummary } from '../shared/api.js'
import { badRequest, notFound } from './http.js'

/**
 * Hono path patterns behind API_ROUTES.prs / API_ROUTES.pr (shared/api.ts
 * builds concrete URLs; these are the parameterised forms the router needs).
 */
export const PRS_ROUTE = '/api/projects/:projectId/prs'
export const PR_ROUTE = `${PRS_ROUTE}/:number`

export interface ProjectScope {
  project: Project
  repo: RepoRef
}

export interface PrScope extends ProjectScope {
  number: number
}

/** The project named by `:projectId`, or a 404. */
export function resolveProject(ctx: ServerContext, c: Context): ProjectScope {
  const id = c.req.param('projectId')
  const project = id ? getProject(ctx.db, id) : undefined
  if (!project) throw notFound('project')
  return { project, repo: { owner: project.owner, repo: project.repo } }
}

/** The project plus a validated `:number` (positive integer), or a 404 / 400. */
export function resolvePr(ctx: ServerContext, c: Context): PrScope {
  const scope = resolveProject(ctx, c)
  const raw = c.req.param('number') ?? ''
  const number = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1) {
    throw badRequest(`invalid pull request number "${raw}"`)
  }
  return { ...scope, number }
}

export function registerPullRoutes(app: Hono, ctx: ServerContext, deps: { forge: Forge }): void {
  const { forge } = deps

  app.get(PRS_ROUTE, async (c) => {
    const { repo } = resolveProject(ctx, c)
    const prs: PullRequestSummary[] = await forge.listOpenPullRequests(repo)
    return c.json(prs)
  })

  app.get(PR_ROUTE, async (c) => {
    const { repo, number } = resolvePr(ctx, c)
    const pr: PullRequestDetail = await forge.getPullRequest(repo, number)
    return c.json(pr)
  })
}
