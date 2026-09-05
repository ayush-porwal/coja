import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isStepCount, streamText, tool } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CODEX_PROTOCOL, type CodexProtocol } from './protocol.js'
import { createCodexLanguageModel, parseSse, subscriptionBody } from './provider.js'

// ---------------------------------------------------------------------------
// Mock Codex backend: a local HTTP server speaking the §1.4/SSE wire
// ---------------------------------------------------------------------------

interface RecordedRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

const sse = (events: [string, unknown][]): string =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')

const CREATED: [string, unknown] = [
  'response.created',
  {
    type: 'response.created',
    response: { id: 'resp_1', created_at: 1_725_500_000, model: 'gpt-5.4' },
  },
]

const USAGE = {
  input_tokens: 5,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 2,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 7,
}

const messageTurn = (text: string): [string, unknown][] => [
  CREATED,
  [
    'response.output_item.added',
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] },
    },
  ],
  [
    'response.output_text.delta',
    { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: text },
  ],
  [
    'response.output_item.done',
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    },
  ],
  [
    'response.completed',
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        created_at: 1_725_500_000,
        model: 'gpt-5.4',
        usage: USAGE,
        output: [],
      },
    },
  ],
]

const toolTurn = (): [string, unknown][] => [
  CREATED,
  [
    'response.output_item.added',
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '' },
    },
  ],
  [
    'response.output_item.done',
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"q":"test"}',
        status: 'completed',
      },
    },
  ],
  [
    'response.completed',
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        created_at: 1_725_500_000,
        model: 'gpt-5.4',
        usage: USAGE,
        output: [],
      },
    },
  ],
]

function startBackend(
  respond: (
    call: number,
    req: RecordedRequest,
  ) => { status: number; body: string; headers?: Record<string, string> },
): Promise<{
  server: Server
  requests: RecordedRequest[]
  url: string
  close: () => Promise<void>
}> {
  const requests: RecordedRequest[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key] = value
      }
      const recorded: RecordedRequest = {
        url: req.url ?? '/',
        headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
      }
      requests.push(recorded)
      const outcome = respond(requests.length, recorded)
      res.writeHead(outcome.status, { 'content-type': 'text/event-stream', ...outcome.headers })
      res.end(outcome.body)
    })
  })
  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${port}/backend-api/codex/responses`,
        close,
      })
    })
  })
}

function makeModel(
  backendUrl: string,
  opts: {
    forceRefresh?: () => Promise<{ accessToken: string; accountId?: string }>
    reasoningEffort?: string
    defaultReasoningEffort?: string
  } = {},
) {
  const tokens = {
    getFreshAccessToken: async () => ({ accessToken: 'tok-1', accountId: 'acct-9' }),
    forceRefresh:
      opts.forceRefresh ?? (async () => ({ accessToken: 'tok-2', accountId: 'acct-9' })),
  }
  const protocol: CodexProtocol = { ...CODEX_PROTOCOL, responsesUrl: backendUrl }
  return {
    model: createCodexLanguageModel({
      tokens,
      modelId: 'gpt-5.4',
      protocol,
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts.defaultReasoningEffort
        ? { defaultReasoningEffort: opts.defaultReasoningEffort }
        : {}),
    }),
    tokens,
  }
}

const lookupTool = tool({
  description: 'Look a thing up',
  inputSchema: z.object({ q: z.string() }),
  execute: async ({ q }) => `result:${q}`,
})

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

// ---------------------------------------------------------------------------
// Body rewrite
// ---------------------------------------------------------------------------

describe('subscriptionBody', () => {
  it('forces the fixed fields, drops rejected parameters and requests encrypted reasoning', () => {
    const out = subscriptionBody({
      model: 'gpt-5.4',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      stream: false,
      temperature: 0.5,
      max_output_tokens: 4096,
      top_p: 0.9,
      truncation: 'auto',
      stream_options: { include_usage: true },
      user: 'user-1',
      tools: [{ type: 'function', name: 'lookup' }],
    })
    expect(out.stream).toBe(true)
    expect(out.store).toBe(false)
    expect(out.parallel_tool_calls).toBe(false)
    expect(out.include).toEqual(['reasoning.encrypted_content'])
    for (const rejected of [
      'temperature',
      'max_output_tokens',
      'top_p',
      'truncation',
      'stream_options',
      'user',
    ]) {
      expect(rejected in out).toBe(false)
    }
    expect(out.tools).toEqual([{ type: 'function', name: 'lookup' }])
  })

  it('strips server-side ids and item references from the echoed input', () => {
    const out = subscriptionBody({
      input: [
        {
          type: 'message',
          id: 'msg_abc',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
        { type: 'reasoning', id: 'rs_abc', encrypted_content: 'enc' },
        { type: 'function_call', id: 'fc_abc', call_id: 'call_1', name: 'lookup', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'result' },
        { type: 'item_reference', id: 'ite_abc' },
      ],
    })
    const input = out.input as Record<string, unknown>[]
    expect(input.map((item) => item.type)).toEqual([
      'message',
      'reasoning',
      'function_call',
      'function_call_output',
    ])
    const [message, reasoning, call, output] = input
    expect(message).not.toHaveProperty('id')
    expect(reasoning).not.toHaveProperty('id')
    expect(reasoning?.encrypted_content).toBe('enc')
    expect(call).not.toHaveProperty('id')
    expect(call?.call_id).toBe('call_1')
    expect(output?.call_id).toBe('call_1')
  })

  it('keeps an existing include list and adds the reasoning entry once', () => {
    const once = subscriptionBody({ include: ['reasoning.encrypted_content'] })
    expect(once.include).toEqual(['reasoning.encrypted_content'])
    const appended = subscriptionBody({ include: ['x'] })
    expect(appended.include).toEqual(['x', 'reasoning.encrypted_content'])
  })
})

// ---------------------------------------------------------------------------
// Streaming through the real @ai-sdk/openai Responses provider
// ---------------------------------------------------------------------------

describe('codex transport', () => {
  it('streams a tool loop: fixed body fields, headers, and the tool result round-trip', async () => {
    const backend = await startBackend((call, req) => {
      if (call === 1) return { status: 200, body: sse(toolTurn()) }
      // The second call must echo the tool output for its function call.
      expect(JSON.stringify(req.body.input)).toContain('function_call_output')
      return { status: 200, body: sse(messageTurn('Hello, world')) }
    })
    servers.push(backend.server)
    const { model } = makeModel(backend.url)

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Look up test' }],
      tools: { lookup: lookupTool },
      stopWhen: isStepCount(5),
      maxOutputTokens: 4096, // the harness always sets this; the transport must drop it
    })
    expect(await result.text).toBe('Hello, world')

    expect(backend.requests).toHaveLength(2)
    const first = backend.requests[0] ?? { url: '', headers: {}, body: {} }
    expect(first.url).toContain('/backend-api/codex/responses?')
    expect(first.url).toMatch(/client_version=\d/)
    expect(first.headers.authorization).toBe('Bearer tok-1')
    expect(first.headers['chatgpt-account-id']).toBe('acct-9')
    expect(first.headers['openai-beta']).toBe('responses=experimental')
    expect(first.headers.originator).toBe('codex_cli_rs')
    expect(first.headers.session_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.body.model).toBe('gpt-5.4')
    expect(first.body.store).toBe(false)
    expect(first.body.stream).toBe(true)
    expect(first.body.parallel_tool_calls).toBe(false)
    expect(first.body.include).toContain('reasoning.encrypted_content')
    expect('max_output_tokens' in first.body).toBe(false)
    expect(Array.isArray(first.body.input)).toBe(true)
    expect(JSON.stringify(first.body.tools)).toContain('lookup')
  })

  it('retries once on 401 through a forced refresh, then fails as auth_expired', async () => {
    const forceRefresh = vi.fn(async () => ({ accessToken: 'tok-2', accountId: 'acct-9' }))
    const backend = await startBackend((call) => {
      if (call === 1) return { status: 401, body: JSON.stringify({ error: 'token expired' }) }
      if (call === 2) {
        return { status: 200, body: sse(messageTurn('after refresh')) }
      }
      return { status: 401, body: JSON.stringify({ error: 'still expired' }) }
    })
    servers.push(backend.server)
    const { model } = makeModel(backend.url, { forceRefresh })

    const result = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    expect(await result.text).toBe('after refresh')
    expect(forceRefresh).toHaveBeenCalledTimes(1)
    expect(backend.requests[1]?.headers.authorization).toBe('Bearer tok-2')

    // A second 401 after the refresh retry surfaces as the typed auth error,
    // marked for the chat UI.
    const backend2 = await startBackend(() => ({ status: 401, body: '{"error":"dead"}' }))
    servers.push(backend2.server)
    const { model: model2 } = makeModel(backend2.url)
    const failing = streamText({ model: model2, messages: [{ role: 'user', content: 'hi' }] })
    const errors: unknown[] = []
    for await (const part of failing.fullStream) {
      if (part.type === 'error') errors.push(part.error)
    }
    expect(errors).toHaveLength(1)
    const err = errors[0] as { name?: string; message?: string }
    expect(err.name).toBe('CodexError')
    expect(err.message).toContain('[coja:chatgpt:auth_expired]')
  })

  it('maps 429 to the typed quota error and 5xx to transport, redacting bodies', async () => {
    const quota = await startBackend(() => ({
      status: 429,
      body: '{"error":{"type":"usage_limit_reached","message":"plan window"}}',
      headers: { 'retry-after': '30' },
    }))
    servers.push(quota.server)
    const { model: quotaModel } = makeModel(quota.url)
    const failing = streamText({ model: quotaModel, messages: [{ role: 'user', content: 'hi' }] })
    const errors: unknown[] = []
    for await (const part of failing.fullStream) {
      if (part.type === 'error') errors.push(part.error)
    }
    const quotaError = errors[0] as {
      name: string
      message: string
      code: string
      extra?: { retryAfterMs?: number }
    }
    expect(quotaError.name).toBe('CodexError')
    expect(quotaError.code).toBe('quota')
    expect(quotaError.message).toContain('[coja:chatgpt:quota]')
    expect(quotaError.extra?.retryAfterMs).toBe(30_000)

    const moved = await startBackend(() => ({
      status: 503,
      body: '<html>unavailable</html>',
    }))
    servers.push(moved.server)
    const { model: movedModel } = makeModel(moved.url)
    const failing2 = streamText({ model: movedModel, messages: [{ role: 'user', content: 'hi' }] })
    const errors2: unknown[] = []
    for await (const part of failing2.fullStream) {
      if (part.type === 'error') errors2.push(part.error)
    }
    const transport = errors2[0] as { code: string; message: string }
    expect(transport.code).toBe('transport')
    expect(transport.message).toContain('[coja:chatgpt:transport]')
    expect(transport.message).not.toContain('tok-1')
  })

  it('redacts token fields from backend error bodies', async () => {
    const backend = await startBackend(() => ({
      status: 400,
      body: '{"error":{"metadata":{"access_token":"tok-secret-1"},"message":"bad"}}',
    }))
    servers.push(backend.server)
    const { model } = makeModel(backend.url)
    const failing = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    const errors: unknown[] = []
    for await (const part of failing.fullStream) {
      if (part.type === 'error') errors.push(part.error)
    }
    const message = (errors[0] as { message: string }).message
    expect(message).not.toContain('tok-secret-1')
    expect(message).toContain('access_token')
  })
})

describe('reasoning effort', () => {
  it('sends the catalog default when the request carries no reasoning, and the chosen effort over it', async () => {
    const backend = await startBackend((call) => {
      const effort = call === 1 ? 'xhigh' : 'low'
      return { status: 200, body: sse(messageTurn(`effort-${effort}`)) }
    })
    servers.push(backend.server)
    const { model: withDefault } = makeModel(backend.url, { defaultReasoningEffort: 'xhigh' })
    const r1 = streamText({ model: withDefault, messages: [{ role: 'user', content: 'hi' }] })
    expect(await r1.text).toBe('effort-xhigh')
    expect(backend.requests[0]?.body.reasoning).toEqual({ effort: 'xhigh' })

    const { model: withChosen } = makeModel(backend.url, {
      reasoningEffort: 'low',
      defaultReasoningEffort: 'xhigh',
    })
    const r2 = streamText({ model: withChosen, messages: [{ role: 'user', content: 'hi' }] })
    expect(await r2.text).toBe('effort-low')
    expect(backend.requests[1]?.body.reasoning).toEqual({ effort: 'low' })
  })
})

// ---------------------------------------------------------------------------
// doGenerate collapse (generateText path)
// ---------------------------------------------------------------------------

describe('doGenerate collapse', () => {
  it('serves a non-streaming request from a collapsed SSE stream', async () => {
    const { generateText } = await import('ai')
    const backend = await startBackend(() => ({
      status: 200,
      body: sse(messageTurn('Collapsed text')),
    }))
    servers.push(backend.server)
    const { model } = makeModel(backend.url)

    const result = await generateText({ model, messages: [{ role: 'user', content: 'hi' }] })
    expect(result.text).toBe('Collapsed text')
    // The collapsed payload restored the items the backend sends via output_item.done.
    expect(backend.requests[0]?.body.stream).toBe(true) // forced streaming upstream
  })
})

// ---------------------------------------------------------------------------
// SSE parser (collapse path)
// ---------------------------------------------------------------------------

describe('parseSse', () => {
  it('parses events across chunk-split boundaries and handles [DONE]', () => {
    const events = parseSse(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"He"}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"y"}\n\ndata: [DONE]\n',
    )
    expect(events).toHaveLength(2)
    const first = (events[0]?.data ?? {}) as { delta: string }
    const second = (events[1]?.data ?? {}) as { delta: string }
    expect(first.delta + second.delta).toBe('Hey')
  })

  it('tolerates CRLF framing and comment lines', () => {
    const events = parseSse(': keep-alive\r\n\r\nevent: x\r\ndata: {"type":"x"}\r\n\r\n')
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('x')
  })
})
