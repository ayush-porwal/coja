import type { AddProjectRequest } from '@coja/shared/api'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAddProject } from '../api/hooks'
import { Button, cn, Field, focusRing, Input } from '../ui'

type Mode = AddProjectRequest['kind']

export interface AddProjectPanelProps {
  /** Empty-state variant: dashed frame plus the "Add a project" copy from the design. */
  intro: boolean
  className?: string
}

export function AddProjectPanel({ intro, className }: AddProjectPanelProps) {
  const [mode, setMode] = useState<Mode>('local')
  const [path, setPath] = useState('')
  const [slug, setSlug] = useState('')
  const add = useAddProject()
  const navigate = useNavigate()

  const value = (mode === 'local' ? path : slug).trim()
  const errorMessage = add.isError ? add.error.message : undefined

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    add.reset()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!value || add.isPending) return
    const body: AddProjectRequest =
      mode === 'local' ? { kind: 'local', path: value } : { kind: 'clone', slug: value }
    add.mutate(body, { onSuccess: (project) => navigate(`/p/${project.id}`) })
  }

  let submitLabel = 'Add project'
  if (add.isPending) submitLabel = mode === 'clone' ? 'Cloning…' : 'Adding…'

  return (
    <section
      aria-labelledby="add-project-heading"
      className={cn(
        'rounded-lg border bg-white p-5 dark:bg-zinc-900',
        intro
          ? 'border-dashed border-zinc-300 dark:border-zinc-700'
          : 'border-zinc-200 dark:border-zinc-800',
        className,
      )}
    >
      <h2 id="add-project-heading" className="text-base font-semibold tracking-tight">
        {intro ? 'Add a project' : 'Add project'}
      </h2>
      {intro && (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Point coja at a local clone — we read <code className="font-mono">origin</code> to
          identify the GitHub repo — or give it a GitHub{' '}
          <code className="font-mono">owner/repo</code> to clone into app storage.
        </p>
      )}

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        <fieldset className="inline-flex self-start rounded-md border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
          <legend className="sr-only">Project source</legend>
          <SegmentButton active={mode === 'local'} onClick={() => switchMode('local')}>
            Local clone
          </SegmentButton>
          <SegmentButton active={mode === 'clone'} onClick={() => switchMode('clone')}>
            Clone from GitHub
          </SegmentButton>
        </fieldset>

        {mode === 'local' ? (
          <Field
            label="Path to a local clone"
            htmlFor="project-path"
            hint={
              <>
                Absolute path. We read <code className="font-mono">origin</code> to find the GitHub
                repo; your checkout and branches are never touched.
              </>
            }
            error={errorMessage}
          >
            <Input
              id="project-path"
              name="path"
              className="font-mono"
              placeholder="/Users/you/src/my-repo"
              autoComplete="off"
              spellCheck={false}
              value={path}
              invalid={add.isError}
              onChange={(event) => {
                setPath(event.target.value)
                if (add.isError) add.reset()
              }}
            />
          </Field>
        ) : (
          <Field
            label="GitHub repository"
            htmlFor="project-slug"
            hint={
              <>
                <code className="font-mono">owner/repo</code> — cloned into coja's own storage;
                nothing is written to your working directories.
              </>
            }
            error={errorMessage}
          >
            <Input
              id="project-slug"
              name="slug"
              className="font-mono"
              placeholder="owner/repo"
              autoComplete="off"
              spellCheck={false}
              value={slug}
              invalid={add.isError}
              onChange={(event) => {
                setSlug(event.target.value)
                if (add.isError) add.reset()
              }}
            />
          </Field>
        )}

        <div>
          <Button type="submit" variant="primary" disabled={!value} loading={add.isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </section>
  )
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
        focusRing,
        active
          ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  )
}
