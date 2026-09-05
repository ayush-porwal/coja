import type { AiContextResponse, Chat, ChatWithMessages, ModelInfo } from '@coja/shared/api'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../api/queryClient'
import { installMockApi, jsonError, type MockRoutes } from '../../test/mockApi'
import { makeDetail } from '../testFixtures'
import { AiPanel } from './AiPanel'

const models: ModelInfo[] = [
  { id: 'openai:gpt-5-mini', provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 mini' },
  {
    id: 'anthropic:claude-sonnet-4-5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
  },
]

const chat1: Chat = {
  id: 'c1',
  projectId: 'p1',
  prNumber: 1,
  title: 'Explain the TTL change',
  model: 'openai:gpt-5-mini',
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T01:00:00Z',
}
const chat2: Chat = { ...chat1, id: 'c2', title: null, updatedAt: '2026-09-04T01:00:00Z' }

const record1: ChatWithMessages = {
  chat: chat1,
  messages: [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Explain the TTL change' }] },
    {
      id: 'm2',
      role: 'assistant',
      metadata: { model: 'openai:gpt-5-mini' },
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'The TTL moved to **src/auth/session.ts:12**.' },
      ],
    },
  ],
}

const context: AiContextResponse = {
  system: 'You are reviewing pull request #1: Session rotation with audit log.',
  tools: [
    { name: 'read_file', description: 'Read a file at head or base.' },
    { name: 'grep', description: 'Search file contents.' },
  ],
}

const BASE = '/api/projects/p1/prs/1'

function routes(over: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/ai/models': models,
    [`GET ${BASE}/chats`]: [],
    [`GET ${BASE}/ai-context`]: context,
    ...over,
  }
}

function renderPanel(queryDefaults: Parameters<typeof createQueryClient>[0] = { retry: false }) {
  const client = createQueryClient(queryDefaults)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AiPanel projectId="p1" number={1} detail={makeDetail()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const modelSelect = () => screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
const textarea = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

beforeEach(() => {
  localStorage.clear()
})

describe('AiPanel — model picker', () => {
  it('lists models grouped by provider, defaults to the first and persists the choice', async () => {
    installMockApi(routes())
    renderPanel()
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))
    const groups = Array.from(modelSelect().querySelectorAll('optgroup')).map((g) => g.label)
    expect(groups).toEqual(['OpenAI', 'Anthropic'])
    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeDefined()

    fireEvent.change(modelSelect(), { target: { value: 'anthropic:claude-sonnet-4-5' } })
    expect(modelSelect().value).toBe('anthropic:claude-sonnet-4-5')
    await waitFor(() =>
      expect(localStorage.getItem('coja.aiModel')).toBe(
        JSON.stringify('anthropic:claude-sonnet-4-5'),
      ),
    )
  })

  it('falls back to the first model when the stored one is gone', async () => {
    localStorage.setItem('coja.aiModel', JSON.stringify('openai:retired-model'))
    installMockApi(routes())
    renderPanel()
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))
  })

  it('shows the no-provider notice and disables the composer when no model is configured', async () => {
    installMockApi(routes({ 'GET /api/ai/models': [] }))
    renderPanel()
    const notice = await screen.findByText(/No AI provider configured/)
    expect(notice.getAttribute('role')).toBe('status')
    expect(within(notice).getByRole('link', { name: 'Setup' }).getAttribute('href')).toBe('/setup')
    expect(textarea().disabled).toBe(true)
    expect(textarea().placeholder).toContain('No AI provider configured')
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveProperty('disabled', true)
    // The rest of the panel still renders (the review tool keeps working without AI).
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })
})

describe('AiPanel — conversations', () => {
  it('resumes the most recent chat, renders its messages and lists history with the current one marked', async () => {
    installMockApi(
      routes({
        [`GET ${BASE}/chats`]: [chat1, chat2],
        [`GET ${BASE}/chats/c1`]: record1,
      }),
    )
    renderPanel()
    expect(await screen.findByText('Explain the TTL change')).toBeDefined()
    // Citations in persisted assistant text navigate; the model shows under the message.
    expect(screen.getByRole('button', { name: 'src/auth/session.ts:12' })).toBeDefined()
    expect(
      within(screen.getByRole('article', { name: 'Assistant' })).getByText('GPT-5 mini'),
    ).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    const history = screen.getByRole('region', { name: 'Chat history' })
    const items = within(history).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('Explain the TTL change')
    expect(items[0]?.textContent).toContain('current')
    expect(items[1]?.textContent).toContain('New chat')
    expect(within(items[0] as HTMLElement).getByRole('button', { current: true })).toBeDefined()
  })

  it('resumes the chat remembered in localStorage and drops it when the server no longer has it', async () => {
    localStorage.setItem('coja.aiChat:p1:1', JSON.stringify('gone'))
    const mock = installMockApi(
      routes({
        [`GET ${BASE}/chats`]: [chat1],
        [`GET ${BASE}/chats/gone`]: () => jsonError(404, 'chat not found', 'not_found'),
        [`GET ${BASE}/chats/c1`]: record1,
      }),
    )
    renderPanel()
    // Falls back to the most recent chat once the stale id 404s.
    expect(await screen.findByText('Explain the TTL change')).toBeDefined()
    expect(mock.callsTo('GET', `${BASE}/chats/gone`)).toHaveLength(1)
    await waitFor(() => expect(localStorage.getItem('coja.aiChat:p1:1')).toBe('null'))
  })

  it('"New chat" creates a chat with the current model and switches to it', async () => {
    const created: Chat = { ...chat2, id: 'c3', updatedAt: '2026-09-05T02:00:00Z' }
    const mock = installMockApi(
      routes({
        [`GET ${BASE}/chats`]: [chat1],
        [`GET ${BASE}/chats/c1`]: record1,
        [`POST ${BASE}/chats`]: created,
      }),
    )
    renderPanel()
    expect(await screen.findByText('Explain the TTL change')).toBeDefined()
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    await waitFor(() => expect(mock.callsTo('POST', `${BASE}/chats`)).toHaveLength(1))
    expect(mock.callsTo('POST', `${BASE}/chats`)[0]?.body).toEqual({ model: 'openai:gpt-5-mini' })
    // Switched: the old conversation is gone, the empty state shows, the id is remembered.
    await waitFor(() => expect(screen.queryByText('Explain the TTL change')).toBeNull())
    expect(screen.getByRole('list', { name: 'Suggestions' })).toBeDefined()
    expect(localStorage.getItem('coja.aiChat:p1:1')).toBe(JSON.stringify('c3'))
  })

  it('creates the chat on the first send and posts the full message list with the model', async () => {
    const created: Chat = { ...chat2, id: 'c9' }
    const mock = installMockApi(
      routes({
        [`POST ${BASE}/chats`]: created,
        [`POST ${BASE}/chats/c9/messages`]: () => jsonError(500, 'provider exploded', 'provider'),
      }),
    )
    renderPanel()
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))
    expect(screen.getByRole('list', { name: 'Suggestions' })).toBeDefined()

    // Suggestions fill the composer without sending.
    fireEvent.click(screen.getByRole('button', { name: 'Walk me through src/auth/session.ts' }))
    expect(textarea().value).toBe('Walk me through src/auth/session.ts')
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })

    await waitFor(() => expect(mock.callsTo('POST', `${BASE}/chats/c9/messages`)).toHaveLength(1))
    const body = mock.callsTo('POST', `${BASE}/chats/c9/messages`)[0]?.body as {
      model: string
      messages: { role: string; parts: unknown[] }[]
    }
    expect(body.model).toBe('openai:gpt-5-mini')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[0]?.parts).toEqual([{ type: 'text', text: 'hello' }])
    expect(Object.keys(body).sort()).toEqual(['messages', 'model'])

    // The user message is in the list; the failed request shows the server's message with Retry.
    expect(screen.getByRole('article', { name: 'You' }).textContent).toContain('hello')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('provider exploded')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeDefined()
  })

  it('"Start a new conversation" after a load failure creates a fresh chat rather than re-selecting the broken one', async () => {
    const created: Chat = { ...chat2, id: 'c3', updatedAt: '2026-09-05T03:00:00Z' }
    const mock = installMockApi(
      routes({
        [`GET ${BASE}/chats`]: [chat1],
        [`GET ${BASE}/chats/c1`]: () => jsonError(500, 'database is locked', 'git'),
        [`POST ${BASE}/chats`]: created,
      }),
    )
    // The record query retries a non-404 once; no delay keeps the test quick.
    renderPanel({ retry: false, retryDelay: 0 })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load this chat')
    expect(alert.textContent).toContain('database is locked')
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))
    const attempts = mock.callsTo('GET', `${BASE}/chats/c1`).length
    expect(attempts).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Start a new conversation' }))
    await waitFor(() => expect(mock.callsTo('POST', `${BASE}/chats`)).toHaveLength(1))
    expect(mock.callsTo('POST', `${BASE}/chats`)[0]?.body).toEqual({ model: 'openai:gpt-5-mini' })
    // The new, empty chat is current; the failure is gone; the broken chat is not fetched again.
    expect(await screen.findByRole('list', { name: 'Suggestions' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(localStorage.getItem('coja.aiChat:p1:1')).toBe(JSON.stringify('c3'))
    expect(mock.callsTo('GET', `${BASE}/chats/c1`)).toHaveLength(attempts)
  })

  it('deletes a chat from the history after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let deleted = false
    const mock = installMockApi(
      routes({
        [`GET ${BASE}/chats`]: () => (deleted ? [chat1] : [chat1, chat2]),
        [`GET ${BASE}/chats/c1`]: record1,
        [`DELETE ${BASE}/chats/c2`]: () => {
          deleted = true
          return { ok: true }
        },
      }),
    )
    renderPanel()
    expect(await screen.findByText('Explain the TTL change')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat New chat' }))
    await waitFor(() => expect(mock.callsTo('DELETE', `${BASE}/chats/c2`)).toHaveLength(1))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Chat history' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    )
  })
})

describe('AiPanel — what does the AI see?', () => {
  it('opens a dialog with the verbatim system prompt and the tool list', async () => {
    const mock = installMockApi(routes())
    renderPanel()
    await waitFor(() => expect(modelSelect().value).toBe('openai:gpt-5-mini'))
    expect(mock.callsTo('GET', `${BASE}/ai-context`)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'What does the AI see?' }))
    expect(await screen.findByTestId('system-prompt')).toHaveProperty('textContent', context.system)
    const tools = screen.getByRole('list', { name: 'Tools' })
    expect(
      within(tools)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['read_file — Read a file at head or base.', 'grep — Search file contents.'])
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('system-prompt')).toBeNull())
  })
})
