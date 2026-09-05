import type { Project } from '@coja/shared/api'
import { Link } from 'react-router'
import { useDeleteProject, useProjects } from '../api/hooks'
import { AppShell, Badge, Button, cn, ErrorNotice, focusRing, SkeletonRows } from '../ui'
import { AddProjectPanel } from './AddProjectPanel'

/** Home (design §2): the project list plus the add-project panel. */
export function ProjectsScreen() {
  const projects = useProjects()
  const isEmpty = projects.data?.length === 0

  return (
    <AppShell
      actions={
        <Link
          to="/setup"
          className={cn(
            'rounded-sm text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            focusRing,
          )}
        >
          Setup
        </Link>
      }
    >
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
        {projects.data && projects.data.length > 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {projects.data.length} {projects.data.length === 1 ? 'project' : 'projects'}
          </span>
        )}
      </div>

      <div className="mt-4">
        {projects.isPending ? (
          <SkeletonRows rows={3} label="Loading projects" />
        ) : projects.isError ? (
          <ErrorNotice
            title="Couldn't load projects"
            message={projects.error.message}
            onRetry={() => void projects.refetch()}
            retrying={projects.isFetching}
          />
        ) : isEmpty ? null : (
          <ProjectList projects={projects.data} />
        )}
      </div>

      <AddProjectPanel intro={isEmpty} className="mt-6" />
    </AppShell>
  )
}

function ProjectList({ projects }: { projects: Project[] }) {
  const remove = useDeleteProject()

  const confirmRemove = (project: Project) => {
    const slug = `${project.owner}/${project.repo}`
    const note = project.kind === 'local' ? ' Your clone on disk is left untouched.' : ''
    if (window.confirm(`Remove ${slug} from coja?${note}`)) remove.mutate(project.id)
  }

  return (
    <div>
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            removing={remove.isPending && remove.variables === project.id}
            onRemove={() => confirmRemove(project)}
          />
        ))}
      </ul>
      {remove.isError && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {remove.error.message}
        </p>
      )}
    </div>
  )
}

function ProjectRow({
  project,
  removing,
  onRemove,
}: {
  project: Project
  removing: boolean
  onRemove: () => void
}) {
  const slug = `${project.owner}/${project.repo}`
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link
        to={`/p/${project.id}`}
        className={cn('group min-w-0 flex-1 rounded-sm', focusRing)}
        aria-label={`Open ${slug}`}
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold group-hover:underline">{slug}</span>
          <Badge tone={project.kind === 'local' ? 'neutral' : 'indigo'}>
            {project.kind === 'local' ? 'local clone' : 'cloned'}
          </Badge>
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {project.path}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={`Remove ${slug}`}
        title={`Remove ${slug}`}
        loading={removing}
        onClick={onRemove}
      >
        {!removing && <TrashIcon />}
      </Button>
    </li>
  )
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M2.5 4h11M6 4V2.5h4V4M3.5 4l.8 9.5h7.4l.8-9.5M6.5 7v4M9.5 7v4" />
    </svg>
  )
}
