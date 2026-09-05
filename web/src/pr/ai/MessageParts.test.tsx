import type { ContextChip } from '@coja/shared/api'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bridge } from '../bridge'
import { describeChatError, MessageList } from './MessageList'
import { MessageParts } from './MessageParts'
import type { ChatMessage } from './types'

const paths = ['src/auth.ts', 'src/util/ttl.ts']

const chip: ContextChip = {
  id: 'chip-1',
  kind: 'selection',
  path: 'src/auth.ts',
  ref: 'head',
  side: 'RIGHT',
  startLine: 41,
  endLine: 58,
  text: 'const ttl = 60\nreturn ttl',
}

function assistant(parts: ChatMessage['parts'], metadata?: ChatMessage['metadata']): ChatMessage {
  return { id: 'a1', role: 'assistant', parts, ...(metadata ? { metadata } : {}) }
}

describe('MessageParts — tool calls', () => {
  it('renders a completed call with its summary, a check mark and the expandable result', () => {
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          {
            type: 'tool-read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { ref: 'head', path: 'src/auth.ts', startLine: 41, endLine: 58 },
            output: {
              path: 'src/auth.ts',
              ref: 'head',
              oid: 'abc123',
              startLine: 41,
              endLine: 58,
              lineCount: 100,
              content: '41 | const ttl = 60\n42 | return ttl',
            },
          },
        ])}
      />,
    )
    const card = screen.getByRole('region', {
      name: 'Tool call read_file(head, src/auth.ts:41-58)',
    })
    expect(within(card).getByRole('img', { name: 'Completed' })).toBeDefined()
    expect(within(card).queryByRole('status')).toBeNull()
    // The result is collapsed but present in the DOM, so nothing is hidden from the reviewer.
    const details = card.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(card).getByText('Result')).toBeDefined()
    expect(within(card).getByText(/41 \| const ttl = 60/)).toBeDefined()
    expect(within(card).getByText(/"oid": "abc123"/)).toBeDefined()
  })

  it('renders a failed call with the error text', () => {
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          {
            type: 'tool-grep',
            toolCallId: 't2',
            state: 'output-error',
            input: { ref: 'head', pattern: 'TTL' },
            errorText: 'git grep exited with 128',
          },
        ])}
      />,
    )
    const card = screen.getByRole('region', { name: 'Tool call grep(head, "TTL")' })
    expect(within(card).getByRole('img', { name: 'Failed' })).toBeDefined()
    expect(within(card).getByText('git grep exited with 128')).toBeDefined()
    expect(within(card).getByText('Input')).toBeDefined()
    expect(within(card).getByText(/"pattern": "TTL"/)).toBeDefined()
  })

  it('shows a spinner while the call is running', () => {
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          { type: 'tool-git_log', toolCallId: 't3', state: 'input-available', input: {} },
          {
            type: 'tool-list_files',
            toolCallId: 't4',
            state: 'input-streaming',
            input: { ref: 'head' },
          },
        ])}
      />,
    )
    const running = screen.getByRole('region', { name: 'Tool call git_log()' })
    expect(within(running).getByRole('status', { name: 'Running' })).toBeDefined()
    const streaming = screen.getByRole('region', { name: 'Tool call list_files(head)' })
    expect(within(streaming).getByRole('status', { name: 'Running' })).toBeDefined()
  })

  it('renders dynamic tool parts the same way', () => {
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          {
            type: 'dynamic-tool',
            toolName: 'get_diff',
            toolCallId: 't5',
            state: 'output-available',
            input: { file: 'src/index.ts' },
            output: 'diff --git a/src/index.ts b/src/index.ts',
          },
        ])}
      />,
    )
    const card = screen.getByRole('region', { name: 'Tool call get_diff(src/index.ts)' })
    expect(within(card).getByText('diff --git a/src/index.ts b/src/index.ts')).toBeDefined()
  })
})

describe('MessageParts — user messages', () => {
  it('renders data-chip parts as chips that expand to the exact text, then the text', () => {
    const message: ChatMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'data-chip', id: chip.id, data: chip },
        { type: 'text', text: 'Why 60?' },
      ],
    }
    render(<MessageParts message={message} paths={paths} />)
    const toggle = screen.getByRole('button', { name: 'src/auth.ts:41–58 @ head' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('chip-excerpt')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByTestId('chip-excerpt').textContent).toBe(chip.text)
    // Chips in sent messages are not removable.
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.getByText('Why 60?')).toBeDefined()
  })

  it('ignores malformed chip data instead of crashing', () => {
    const message: ChatMessage = {
      id: 'u2',
      role: 'user',
      parts: [
        { type: 'data-chip', data: { nope: true } },
        { type: 'text', text: 'hello' },
      ],
    }
    render(<MessageParts message={message} paths={paths} />)
    expect(screen.getByText('hello')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('MessageParts — assistant text', () => {
  it('renders GFM markdown with citations that scroll the diff', () => {
    const scrolled = vi.fn()
    const off = bridge.onScrollToLine(scrolled)
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          {
            type: 'text',
            text: 'The TTL is set in src/auth.ts:41-58 and read in `ttl.ts:3`.\n\n| a | b |\n|---|---|\n| 1 | 2 |',
          },
        ])}
      />,
    )
    const range = screen.getByRole('button', { name: 'src/auth.ts:41-58' })
    expect(range.getAttribute('title')).toBe('Open src/auth.ts at lines 41–58')
    fireEvent.click(range)
    expect(scrolled).toHaveBeenCalledWith({ path: 'src/auth.ts', line: 41, side: 'RIGHT' })

    const inline = screen.getByRole('button', { name: 'ttl.ts:3' })
    expect(inline.querySelector('code')?.textContent).toBe('ttl.ts:3')
    fireEvent.click(inline)
    expect(scrolled).toHaveBeenLastCalledWith({ path: 'src/util/ttl.ts', line: 3, side: 'RIGHT' })

    expect(screen.getByRole('table')).toBeDefined()
    off()
  })

  it('renders plain links safely and drops unsafe schemes', () => {
    render(
      <MessageParts
        paths={paths}
        message={assistant([
          { type: 'text', text: '[docs](https://example.com) [bad](javascript:alert(1))' },
        ])}
      />,
    )
    const docs = screen.getByRole('link', { name: 'docs' })
    expect(docs.getAttribute('href')).toBe('https://example.com')
    expect(docs.getAttribute('target')).toBe('_blank')
    expect(docs.getAttribute('rel')).toContain('noopener')
    const bad = screen.getByText('bad')
    expect(bad.tagName).toBe('SPAN')
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
  })

  it('renders reasoning collapsed and step-start as dividers (except a leading one)', () => {
    const { container } = render(
      <MessageParts
        paths={paths}
        message={assistant([
          { type: 'step-start' },
          { type: 'reasoning', text: 'Let me look at the file.', state: 'done' },
          { type: 'text', text: 'First.' },
          { type: 'step-start' },
          { type: 'text', text: 'Second.' },
        ])}
      />,
    )
    const details = screen.getByText('Reasoning').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Let me look at the file.')
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })
})

describe('MessageList', () => {
  const noop = () => {}
  const label = (id: string) => (id === 'openai:gpt-5-mini' ? 'GPT-5 mini' : id)

  it('shows the model under assistant messages and suggestions when empty', () => {
    const onSuggest = vi.fn()
    const { rerender } = render(
      <MessageList
        messages={[]}
        status="ready"
        error={undefined}
        onRetry={noop}
        onDismissError={noop}
        paths={paths}
        suggestions={['Summarize what this PR changes and why']}
        onSuggest={onSuggest}
        modelLabel={label}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Summarize what this PR changes and why' }))
    expect(onSuggest).toHaveBeenCalledWith('Summarize what this PR changes and why')

    rerender(
      <MessageList
        messages={[assistant([{ type: 'text', text: 'Done.' }], { model: 'openai:gpt-5-mini' })]}
        status="ready"
        error={undefined}
        onRetry={noop}
        onDismissError={noop}
        paths={paths}
        suggestions={[]}
        onSuggest={onSuggest}
        modelLabel={label}
      />,
    )
    const article = screen.getByRole('article', { name: 'Assistant' })
    expect(within(article).getByText('GPT-5 mini')).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Suggestions' })).toBeNull()
  })

  it('renders the error with Retry (regenerate) and Dismiss (clearError)', () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <MessageList
        messages={[]}
        status="error"
        error={new Error('{"error":"rate limited"}')}
        onRetry={onRetry}
        onDismissError={onDismiss}
        paths={paths}
        suggestions={[]}
        onSuggest={noop}
        modelLabel={label}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('rate limited')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows a thinking indicator while the request is submitted', () => {
    render(
      <MessageList
        messages={[]}
        status="submitted"
        error={undefined}
        onRetry={noop}
        onDismissError={noop}
        paths={paths}
        suggestions={['x']}
        onSuggest={noop}
        modelLabel={label}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Thinking')
    expect(screen.queryByRole('list', { name: 'Suggestions' })).toBeNull()
  })
})

describe('describeChatError', () => {
  it('unwraps the server JSON body and falls back to the raw message', () => {
    expect(describeChatError(new Error('{"error":"No API key configured"}'))).toBe(
      'No API key configured',
    )
    expect(describeChatError(new Error('Failed to fetch'))).toBe('Failed to fetch')
    expect(describeChatError(new Error(''))).toBe('Unknown error')
    expect(describeChatError(new Error('{"error":""}'))).toBe('{"error":""}')
  })
})
