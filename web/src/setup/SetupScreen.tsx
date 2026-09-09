import type {
  CustomApiFormat,
  CustomProviderConfig,
  CustomProviderModel,
  CustomProviderSummary,
  SetupStatus,
} from '@coja/shared/api'
import { type UseQueryResult, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  useAddCustomProvider,
  useChatGptConnectStatus,
  useCompleteSetup,
  useConnectChatGpt,
  useDeleteCustomProvider,
  useDisconnectChatGpt,
  useFetchCustomModels,
  useSetupStatus,
} from '../api/hooks'
import { ThemePicker } from '../themes/ThemePicker'
import { AppShell, Badge, Button, cn, Field, Input, linkClass, Select, Spinner } from '../ui'
import { TypographySection } from './TypographySection'

/**
 * First-run checklist (design §1): GitHub via `gh` is required, AI is
 * optional. Continue marks setup complete and lands on Projects either way.
 */
export function SetupScreen() {
  const status = useSetupStatus()
  const complete = useCompleteSetup()
  const navigate = useNavigate()
  const [finishing, setFinishing] = useState<'continue' | null>(null)

  const data = status.data
  const ghOk = data?.gh.ok === true
  const configured = data?.setupComplete === true

  const finish = () => {
    setFinishing('continue')
    complete.mutate(undefined, {
      onSuccess: () => navigate('/', { replace: true }),
      onSettled: () => setFinishing(null),
    })
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">
          {configured ? 'Settings' : 'Set up coja'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {configured ? (
            'Manage your connections and make coja feel at home.'
          ) : (
            <>Connect GitHub to start reviewing. AI is optional, and you can configure it later.</>
          )}
        </p>

        <section aria-labelledby="connections-heading" className="mt-8">
          <h2 id="connections-heading" className="text-base font-semibold">
            Connections
          </h2>
          <p className="mt-1 text-sm text-muted">
            GitHub powers reviews. Connect an AI provider to use chat.
          </p>
          <ol className="mt-4 rounded-lg border border-edge bg-card p-3">
            <GitHubRow status={status} />
            <RowConnector label="and" />
            <ChatGptRow status={data} />
            <RowConnector label="or" />
            <CustomProvidersRow status={data} />
          </ol>
        </section>

        <section aria-labelledby="appearance-heading" className="mt-8 border-t border-edge pt-6">
          <h2 id="appearance-heading" className="text-base font-semibold">
            Appearance
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            Choose a color palette and a light or dark appearance.
          </p>
          <ThemePicker />
        </section>

        <section aria-labelledby="code-heading" className="mt-8 border-t border-edge pt-6">
          <h2 id="code-heading" className="text-base font-semibold">
            Code
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            Adjust text size and spacing in diffs and code blocks.
          </p>
          <TypographySection />
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {complete.isError && (
            <p role="alert" className="mr-auto text-sm text-danger-text">
              {complete.error.message}
            </p>
          )}
          {data && !configured && !ghOk && (
            <p className="mr-auto text-sm text-muted">
              Sign in with <code className="font-mono">gh</code> to continue.
            </p>
          )}
          {configured ? (
            <Link to="/" className={`${linkClass} rounded text-sm`}>
              Back to projects
            </Link>
          ) : (
            <Button
              variant="primary"
              disabled={!ghOk || complete.isPending}
              loading={complete.isPending && finishing === 'continue'}
              onClick={finish}
            >
              Continue
            </Button>
          )}
        </footer>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * The AND/OR chip between checklist rows: a small badge on the divider line,
 * telling required (GitHub, "and") from the alternative AI sources ("or").
 * Decorative — the copy and badges carry the meaning.
 */
function RowConnector({ label }: { label: 'and' | 'or' }) {
  return (
    <li aria-hidden="true" className="relative flex items-center justify-center py-1">
      <span aria-hidden="true" className="absolute inset-x-3 top-1/2 h-px bg-edge" />
      <span
        className={cn(
          'relative rounded-full border border-edge bg-card px-2.5 py-0.5',
          'text-xs font-semibold tracking-widest text-muted uppercase',
        )}
      >
        {label}
      </span>
    </li>
  )
}

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
        <p className="text-muted">
          Checking <code className="font-mono">gh auth status</code>…
        </p>
      ) : gh.ok ? (
        <p>
          Signed in as <strong className="font-semibold">{gh.login}</strong> via gh
          {gh.host && gh.host !== 'github.com' && <span className="text-muted"> ({gh.host})</span>}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-danger-text">{gh.error ?? 'Not signed in to GitHub.'}</p>
          <p className="text-muted">
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

// ---------------------------------------------------------------------------
// ChatGPT subscription
// ---------------------------------------------------------------------------

/**
 * "Sign in with ChatGPT" (docs/research/chatgpt-subscription-auth.md).
 * Self-contained on purpose: the server runs the OAuth flow and opens the
 * browser; this row starts it, polls until it resolves, and shows connection
 * facts. No token material ever reaches this component.
 */
function ChatGptRow({ status }: { status: SetupStatus | undefined }) {
  const queryClient = useQueryClient()
  const connect = useConnectChatGpt()
  const disconnect = useDisconnectChatGpt()
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  // The poll only follows an open sign-in; the setup status is the source of
  // truth for an already-established connection (e.g. after a page reload).
  const poll = useChatGptConnectStatus(authUrl !== null)
  const chatgpt =
    status?.chatgpt.connected || poll.data?.connected ? (status?.chatgpt ?? poll.data) : poll.data

  useEffect(() => {
    if (poll.data && (poll.data.connected || poll.data.connectError)) {
      setAuthUrl(null)
      void queryClient.invalidateQueries({ queryKey: ['setup'] })
      void queryClient.invalidateQueries({ queryKey: ['ai', 'models'] })
    }
  }, [poll.data?.connected, poll.data?.connectError, queryClient, poll.data])

  const start = () => {
    connect.mutate(undefined, {
      onSuccess: (result) => setAuthUrl(result.authUrl),
    })
  }

  return (
    <ChecklistRow
      glyph={
        chatgpt?.connected ? (
          <Glyph kind="ok" />
        ) : connect.isError ? (
          <Glyph kind="error" />
        ) : (
          <Glyph kind="idle" />
        )
      }
      title="ChatGPT subscription"
    >
      <p className="text-muted">
        Run the AI panel on your ChatGPT plan — the same sign-in the Codex CLI uses, no API key
        needed.
      </p>

      {chatgpt?.connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Glyph kind="ok" small />
          <span className="font-medium">Connected</span>
          {chatgpt.email && <span className="min-w-0 break-all text-muted">{chatgpt.email}</span>}
          {chatgpt.plan && <Badge>{chatgpt.plan}</Badge>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Disconnect ChatGPT"
            loading={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Disconnect
          </Button>
        </div>
      ) : authUrl ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="flex items-center gap-2 text-muted">
            <Spinner size="sm" /> Waiting for you to finish the sign-in in your browser…
          </p>
          <a className={linkClass} href={authUrl} rel="noreferrer">
            Open the sign-in page again
          </a>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={start} loading={connect.isPending}>
              Connect ChatGPT
            </Button>
            <span className="text-xs text-muted">
              A browser window opens; approve access to continue here.
            </span>
          </div>
          {(chatgpt?.connectError || connect.error) && (
            <p role="alert" className="text-xs font-medium text-danger-text">
              {chatgpt?.connectError ?? connect.error?.message}
            </p>
          )}
        </div>
      )}
      {disconnect.isError && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-text">
          {disconnect.error.message}
        </p>
      )}
    </ChecklistRow>
  )
}

// ---------------------------------------------------------------------------
// Custom model providers
// ---------------------------------------------------------------------------

const FORMAT_LABELS: Record<CustomApiFormat, string> = {
  openai: 'OpenAI chat completions (/chat/completions)',
  anthropic: 'Anthropic messages (/messages)',
}

/**
 * User-added endpoints — any host speaking the OpenAI chat-completions or
 * Anthropic messages protocol at a custom base URL (DeepSeek, OpenRouter, a
 * self-hosted proxy, a local Ollama). Models are added by hand: there is no
 * assumed models-list endpoint to discover them from. The key, if the
 * endpoint needs one, is stored like the built-ins' — keychain, never shown.
 */
function CustomProvidersRow({ status }: { status: SetupStatus | undefined }) {
  const add = useAddCustomProvider()
  const remove = useDeleteCustomProvider()
  const providers = status?.customProviders ?? []
  /** null = form closed; 'new' = adding; a config = editing that provider. */
  const [form, setForm] = useState<'new' | CustomProviderConfig | null>(null)
  /** The config being edited, looked up fresh from status so hasKey stays current. */
  const editing =
    form !== null && form !== 'new' ? (providers.find((p) => p.id === form.id) ?? null) : null

  const glyph =
    status === undefined ? (
      <Spinner label="Checking custom providers" />
    ) : providers.length > 0 ? (
      <Glyph kind="ok" />
    ) : (
      <Glyph kind="idle" />
    )

  return (
    <ChecklistRow glyph={glyph} title="Custom providers" badge={<Badge>advanced</Badge>}>
      <p className="text-muted">
        Add any OpenAI- or Anthropic-compatible endpoint — DeepSeek, OpenRouter, a self-hosted
        proxy, a local Ollama.
      </p>

      {providers.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {providers.map((provider) => (
            <CustomProviderItem
              key={provider.id}
              provider={provider}
              busy={
                (remove.isPending && remove.variables === provider.id) ||
                (add.isPending && editing?.id === provider.id)
              }
              onEdit={() => setForm(provider)}
              onRemove={() => remove.mutate(provider.id)}
            />
          ))}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-text">
          {remove.error.message}
        </p>
      )}

      {form !== null ? (
        <AddProviderForm
          key={editing?.id ?? 'new'}
          initial={editing}
          pending={add.isPending}
          error={add.isError ? add.error.message : null}
          onCancel={() => setForm(null)}
          onAdd={(request) =>
            add.mutate(request, {
              onSuccess: () => setForm(null),
            })
          }
        />
      ) : (
        <div className="mt-3">
          <Button size="sm" onClick={() => setForm('new')}>
            Add model provider
          </Button>
        </div>
      )}
    </ChecklistRow>
  )
}

function CustomProviderItem({
  provider,
  busy,
  onEdit,
  onRemove,
}: {
  provider: CustomProviderSummary
  busy: boolean
  onEdit(): void
  onRemove(): void
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Glyph kind="ok" small />
      <span className="max-w-full break-words font-medium">{provider.name}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted"
        title={provider.baseUrl}
      >
        {provider.baseUrl}
      </span>
      <span className="shrink-0 text-xs text-muted">
        {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}
        {provider.hasKey ? ' · key stored' : ''}
      </span>
      <span className="ml-auto flex gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${provider.name}`}
          loading={busy}
          onClick={onRemove}
        >
          Remove
        </Button>
      </span>
    </li>
  )
}

/**
 * The "Add model provider" form (also the editor, via `initial`): endpoint
 * facts plus a hand-curated model list. When editing, the key field starts
 * empty and a blank submit keeps the stored key — it is never shown again, so
 * it could not be re-entered.
 */
function AddProviderForm({
  initial,
  pending,
  error,
  onAdd,
  onCancel,
}: {
  initial?: CustomProviderSummary | null
  pending: boolean
  error: string | null
  onAdd(request: {
    name: string
    baseUrl: string
    apiFormat: CustomApiFormat
    models: CustomProviderModel[]
    apiKey?: string
  }): void
  onCancel(): void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [apiFormat, setApiFormat] = useState<CustomApiFormat>(initial?.apiFormat ?? 'openai')
  const [models, setModels] = useState<CustomProviderModel[]>(initial?.models ?? [])
  const [modelDraft, setModelDraft] = useState('')
  const fetchModels = useFetchCustomModels()
  const [fetchNote, setFetchNote] = useState<string | null>(null)

  const trimmedName = name.trim()
  const trimmedBaseUrl = baseUrl.trim()
  const draft = modelDraft.trim()
  const validUrl = /^https?:\/\//.test(trimmedBaseUrl)

  const addModel = () => {
    const id = draft.trim()
    if (!id || models.some((m) => m.id === id)) return
    setModels((current) => [...current, { id }])
    setModelDraft('')
  }

  /**
   * Ask the endpoint for its model list (the server proxies the call). On
   * success the results merge into the editable chips; on failure a soft note
   * — manual entry always stays open, so a missing /models route never blocks.
   */
  const fetchList = () => {
    setFetchNote(null)
    fetchModels.mutate(
      initial?.id && apiKey.trim() === ''
        ? { id: initial.id }
        : {
            baseUrl: trimmedBaseUrl,
            apiFormat,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          },
      {
        onSuccess: (data) => {
          setModels((current) => {
            const merged = [...current]
            for (const fetched of data.models) {
              const existing = merged.find((m) => m.id === fetched.id)
              if (!existing) merged.push(fetched)
              else if (fetched.label && !existing.label) existing.label = fetched.label
            }
            return merged
          })
          setFetchNote(
            data.models.length === 1
              ? 'Found 1 model — remove any you do not want.'
              : `Found ${data.models.length} models — remove any you do not want.`,
          )
        },
        onError: (e) => setFetchNote(e.message),
      },
    )
  }

  const canFetch = initial?.id !== undefined || validUrl
  const canSubmit = trimmedName !== '' && validUrl && models.length > 0 && !pending

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-md border border-edge p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        onAdd({
          name: trimmedName,
          baseUrl: trimmedBaseUrl,
          apiFormat,
          models,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      }}
    >
      <Field label="Name" htmlFor="custom-name">
        <Input
          id="custom-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. DeepSeek"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field
        label="Base URL"
        htmlFor="custom-base-url"
        hint={
          <>
            Up to the version path — coja appends{' '}
            <code className="font-mono">/chat/completions</code> (OpenAI format) or{' '}
            <code className="font-mono">/messages</code> (Anthropic format). E.g.{' '}
            <code className="font-mono">https://api.deepseek.com/v1</code>
          </>
        }
      >
        <Input
          id="custom-base-url"
          value={baseUrl}
          invalid={trimmedBaseUrl !== '' && !validUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field
        label="API key"
        htmlFor="custom-key"
        hint={
          initial?.hasKey
            ? 'A key is stored. Leave this blank to keep it, or type a replacement.'
            : 'Optional — local endpoints often need none. Stored in your keychain, never shown again.'
        }
      >
        <Input
          id="custom-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter API key"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label="API format" htmlFor="custom-format">
        <Select
          id="custom-format"
          value={apiFormat}
          onChange={(e) => {
            if (e.target.value === 'openai' || e.target.value === 'anthropic') {
              setApiFormat(e.target.value)
            }
          }}
        >
          <option value="openai">{FORMAT_LABELS.openai}</option>
          <option value="anthropic">{FORMAT_LABELS.anthropic}</option>
        </Select>
      </Field>
      <Field label="Model list" htmlFor="custom-model-draft">
        {models.length === 0 ? (
          <p className="rounded-md border border-dashed border-edge px-3 py-2 text-xs text-muted">
            No models are configured. Add a model to use it in chat.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {models.map((model) => (
              <li key={model.id} className="max-w-full">
                <span
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-active py-0.5 pr-1 pl-2.5 font-mono text-xs text-ink"
                  title={model.label ? model.id : undefined}
                >
                  <span className="min-w-0 truncate" title={model.id}>
                    {model.label ?? model.id}
                  </span>
                  {model.label && <span className="min-w-0 truncate text-muted">{model.id}</span>}
                  <button
                    type="button"
                    aria-label={`Remove model ${model.id}`}
                    className="shrink-0 rounded px-1 text-muted hover:bg-hover hover:text-ink"
                    onClick={() => setModels((current) => current.filter((m) => m.id !== model.id))}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            id="custom-model-draft"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addModel()
              }
            }}
            placeholder="e.g. deepseek-chat"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            size="sm"
            type="button"
            disabled={!draft || models.some((m) => m.id === draft.trim())}
            onClick={addModel}
          >
            Add model
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={!canFetch || fetchModels.isPending}
            loading={fetchModels.isPending}
            onClick={fetchList}
          >
            Fetch model list
          </Button>
          <span className="min-w-0 text-xs text-muted">
            Asks {initial?.id ? 'the stored endpoint' : 'the endpoint above'} for GET /models — not
            every endpoint implements it.
          </span>
        </div>
        {fetchNote && (
          <p role={fetchModels.isError ? 'alert' : undefined} className="text-xs text-muted">
            {fetchNote}
          </p>
        )}
      </Field>

      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-text">
          {error}
        </p>
      ) : (
        models.length === 0 && (
          <p className="text-xs text-muted">Add at least one model before adding the provider.</p>
        )
      )}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} loading={pending}>
          {initial ? 'Save changes' : 'Add provider'}
        </Button>
      </div>
    </form>
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
        className={cn(size, 'inline-block rounded-full border-2 border-dashed border-edge-strong')}
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
        ok ? 'bg-ok' : 'bg-danger',
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
