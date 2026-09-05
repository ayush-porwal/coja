import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { addCloneProject, addLocalProject, removeProject } from '../projects/add.js'
import { getProject, listProjects } from '../projects/store.js'
import type { AddProjectRequest, Project } from '../shared/api.js'
import { badRequest, notFound } from './http.js'

/** Mirrors `AddProjectRequest` in shared/api.ts. */
const AddProjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: z.string().trim().min(1) }),
  z.object({ kind: z.literal('clone'), slug: z.string().trim().min(1) }),
]) satisfies z.ZodType<AddProjectRequest>

/**
 * `API_ROUTES.projects` and `API_ROUTES.project`. Register before any `/api/*`
 * catch-all; errors are thrown and mapped by `onApiError`.
 */
export function registerProjectRoutes(app: Hono, ctx: ServerContext): void {
  app.get('/api/projects', (c) => c.json<Project[]>(listProjects(ctx.db)))

  app.post('/api/projects', async (c) => {
    const body = validate(AddProjectSchema, await readJson(c))
    const project =
      body.kind === 'local'
        ? await addLocalProject(ctx, body.path)
        : await addCloneProject(ctx, body.slug)
    return c.json<Project>(project)
  })

  app.get('/api/projects/:projectId', (c) => {
    const project = getProject(ctx.db, c.req.param('projectId'))
    if (!project) throw notFound('project')
    return c.json<Project>(project)
  })

  app.delete('/api/projects/:projectId', async (c) => {
    await removeProject(ctx, c.req.param('projectId'))
    return c.json({ ok: true as const })
  })
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('request body must be JSON')
  }
}

/** Validate a body or query with zod, turning failures into a 400 with a readable summary. */
export function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data as z.output<T>
  const issues = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
  throw badRequest(`invalid request: ${issues}`)
}
