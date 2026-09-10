import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MessageList, type MessageListProps } from './MessageList'
import type { ChatMessage } from './types'

const renders = vi.hoisted(() => vi.fn())
vi.mock('./MessageParts', () => ({
  MessageParts: ({ message }: { message: ChatMessage }) => {
    renders(message.id)
    return <p>{message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}</p>
  },
}))

it('renders only the changing message during streaming, but updates changed dependencies', () => {
  const history: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    role: 'assistant',
    parts: [{ type: 'text', text: `Answer ${i}` }],
  }))
  const props: MessageListProps = {
    messages: history,
    status: 'streaming',
    error: undefined,
    onRetry: vi.fn(),
    onDismissError: vi.fn(),
    paths: [],
    suggestions: [],
    onSuggest: vi.fn(),
    modelLabel: (id) => id,
  }
  const view = render(<MessageList {...props} />)
  renders.mockClear()
  for (let i = 0; i < 20; i++) {
    const messages: ChatMessage[] = [
      ...history.slice(0, -1),
      { id: '99', role: 'assistant', parts: [{ type: 'text', text: `Token ${i}` }] },
    ]
    view.rerender(<MessageList {...props} messages={messages} />)
  }
  expect(renders).toHaveBeenCalledTimes(20)
  expect(screen.getByText('Token 19')).toBeDefined()
  renders.mockClear()
  view.rerender(<MessageList {...props} paths={['new-file.ts']} />)
  expect(renders).toHaveBeenCalledTimes(100)
})
