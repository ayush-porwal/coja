import { randomBytes } from 'node:crypto'
import { type Db, nowIso } from '../db.js'
import type { Project, ProjectKind } from '../shared/api.js'

interface Row {
  id: string
  kind: ProjectKind
  owner: string
  repo: string
  path: string
  created_at: string
}

const toProject = (r: Row): Project => ({
  id: r.id,
  kind: r.kind,
  owner: r.owner,
  repo: r.repo,
  path: r.path,
  createdAt: r.created_at,
})

export function listProjects(db: Db): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY created_at ASC')
    .all() as unknown as Row[]
  return rows.map(toProject)
}

export function getProject(db: Db, id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as
    | Row
    | undefined
  return row ? toProject(row) : undefined
}

export function findProjectByPath(db: Db, path: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as unknown as
    | Row
    | undefined
  return row ? toProject(row) : undefined
}

export function insertProject(
  db: Db,
  input: Pick<Project, 'kind' | 'owner' | 'repo' | 'path'>,
): Project {
  const project: Project = {
    id: randomBytes(6).toString('hex'),
    ...input,
    createdAt: nowIso(),
  }
  db.prepare(
    'INSERT INTO projects (id, kind, owner, repo, path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(project.id, project.kind, project.owner, project.repo, project.path, project.createdAt)
  return project
}

export function deleteProject(db: Db, id: string): boolean {
  const res = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return Number(res.changes) > 0
}
