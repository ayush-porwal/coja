import { PROVIDERS, type ProviderId, type SetupStatus } from '@coja/shared/api'
import type { UseQueryResult } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCompleteSetup, useDeleteKey, useSaveKey, useSetupStatus } from '../api/hooks'
import { AppShell, Badge, Button, cn, Field, Input, linkClass, Select, Spinner } from '../ui'

const PROVIDER_LABELS: Record<ProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic' }

const isProviderId = (value: string): value is ProviderId =>
  (PROVIDERS as readonly string[]).includes(value)

type FinishAction = 'continue' | 'skip'

/**
 * First-run checklist (design §1): GitHub via `gh` is required, an AI key is
 * optional. Both footer buttons mark setup complete and land on Projects.
 */
export function SetupScreen() {
  const status = useSetupStatus()
  const complete = useCompleteSetup()
  const navigate = useNavigate()
  const [finishing, setFinishing] = useState<FinishAction | null>(null)

  const data = status.data
  const ghOk = data?.gh.ok === true
  const anyConfigured = data ? PROVIDERS.some((p) => data.providers[p]?.configured) : false

  const finish = (action: FinishAction) => {
    setFinishing(action)
    complete.mutate(undefined, {
      onSuccess: () => navigate('/', { replace: true }),
      onSettled: () => setFinishing(null),
    })
  }

  return (
    <AppShell
      actions={
        data?.setupComplete && ghOk ? (
          <Link to="/" className={cn(linkClass, 'text-xs')}>
            Back to projects
          </Link>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Set up coja</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Two checks, one required. Reviewing works without AI — the only thing coja needs is a
          GitHub sign-in through the <code className="font-mono">gh</code> CLI.
        </p>

        <ol className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <GitHubRow status={status} />
          <ProviderRow status={data} />
        </ol>

        <footer className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {complete.isError && (
            <p role="alert" className="mr-auto text-sm text-red-600 dark:text-red-400">
              {complete.error.message}
            </p>
          )}
          {data && !ghOk && (
            <p className="mr-auto text-sm text-zinc-500 dark:text-zinc-400">
              Sign in with <code className="font-mono">gh</code> to continue.
            </p>
          )}
          {!anyConfigured && (
            <Button
              variant="secondary"
              disabled={!ghOk || complete.isPending}
              loading={complete.isPending && finishing === 'skip'}
              onClick={() => finish('skip')}
            >
              Skip AI for now
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!ghOk || complete.isPending}
            loading={complete.isPending && finishing === 'continue'}
            onClick={() => finish('continue')}
          >
            Continue
          </Button>
        </footer>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function ChecklistRow({
  glyph,
  title,
  badge,
  children,
}: {
  glyph: ReactNode
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <li className="flex gap-4 p-4">
      <div className="flex size-6 shrink-0 items-center justify-center">{glyph}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge}
        </div>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </li>
  )
}

function GitHubRow({ status }: { status: UseQueryResult<SetupStatus> }) {
  const gh = status.data?.gh
  const checking = status.isFetching

  let glyph: ReactNode
  if (checking || !gh) glyph = <Spinner label="Checking GitHub sign-in" />
  else if (gh.ok) glyph = <Glyph kind="ok" />
  else glyph = <Glyph kind="error" />

  return (
    <ChecklistRow glyph={glyph} title="GitHub">
      {!gh ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          Checking <code className="font-mono">gh auth status</code>…
        </p>
      ) : gh.ok ? (
        <p>
          Signed in as <strong className="font-semibold">{gh.login}</strong> via gh
          {gh.host && gh.host !== 'github.com' && (
            <span className="text-zinc-500 dark:text-zinc-400"> ({gh.host})</span>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-red-700 dark:text-red-300">{gh.error ?? 'Not signed in to GitHub.'}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            coja authenticates only through the GitHub CLI — nothing to paste here.
          </p>
          <div>
            <Button size="sm" onClick={() => void status.refetch()} loading={checking}>
              Check again
            </Button>
          </div>
        </div>
      )}
    </ChecklistRow>
  )
}

function ProviderRow({ status }: { status: SetupStatus | undefined }) {
  const saveKey = useSaveKey()
  const deleteKey = useDeleteKey()
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState<ProviderId | null>(null)

  const configured = status ? PROVIDERS.filter((p) => status.providers[p]?.configured) : []
  const fileBackend = status?.secrets.backend === 'file'
  const trimmedKey = apiKey.trim()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!trimmedKey || saveKey.isPending) return
    saveKey.mutate(
      { provider, apiKey: trimmedKey },
      {
        onSuccess: (result) => {
          setApiKey('')
          setSaved(result.provider)
        },
      },
    )
  }

  return (
    <ChecklistRow
      glyph={configured.length > 0 ? <Glyph kind="ok" /> : <Glyph kind="idle" />}
      title="AI provider"
      badge={<Badge>optional</Badge>}
    >
      <p className="text-zinc-500 dark:text-zinc-400">
        Bring your own OpenAI or Anthropic API key to chat about a PR. You can add one later from
        the Setup link on the Projects page.
      </p>

      {configured.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {configured.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <Glyph kind="ok" small />
              <span className="font-medium">{PROVIDER_LABELS[p]}</span>
              <span className="text-zinc-500 dark:text-zinc-400">configured</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                aria-label={`Remove ${PROVIDER_LABELS[p]} key`}
                loading={deleteKey.isPending && deleteKey.variables === p}
                onClick={() => deleteKey.mutate(p)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {deleteKey.isError && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {deleteKey.error.message}
        </p>
      )}

      <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
          <Field label="Provider" htmlFor="setup-provider">
            <Select
              id="setup-provider"
              name="provider"
              value={provider}
              onChange={(event) => {
                if (isProviderId(event.target.value)) setProvider(event.target.value)
                saveKey.reset()
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="API key" htmlFor="setup-api-key">
            <Input
              id="setup-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
              value={apiKey}
              invalid={saveKey.isError}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSaved(null)
                if (saveKey.isError) saveKey.reset()
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            disabled={!trimmedKey}
            loading={saveKey.isPending}
            className="sm:mb-0"
          >
            Save &amp; validate
          </Button>
        </div>

        {saveKey.isError ? (
          <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
            {saveKey.error.message}
          </p>
        ) : saved ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            {PROVIDER_LABELS[saved]} key validated and saved.
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Validated with a cheap test call{fileBackend ? '' : ', then stored in your OS keychain'}
            . The key is never shown again.
          </p>
        )}
        {fileBackend && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Keychain unavailable — key stored in a 0600 file in coja's data dir.
          </p>
        )}
      </form>
    </ChecklistRow>
  )
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

function Glyph({ kind, small }: { kind: 'ok' | 'error' | 'idle'; small?: boolean }) {
  const size = small ? 'size-4' : 'size-6'
  if (kind === 'idle') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          size,
          'inline-block rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600',
        )}
      />
    )
  }
  const ok = kind === 'ok'
  return (
    <span
      aria-hidden="true"
      className={cn(
        size,
        'inline-flex items-center justify-center rounded-full text-white',
        ok ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-red-600 dark:bg-red-500',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={small ? 'size-2.5' : 'size-3.5'}
      >
        {ok ? <path d="M3 8.5l3.2 3L13 4.5" /> : <path d="M4 4l8 8M12 4l-8 8" />}
      </svg>
    </span>
  )
}
