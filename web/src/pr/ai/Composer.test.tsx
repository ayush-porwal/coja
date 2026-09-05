import type { ContextChip } from '@coja/shared/api'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { bridge } from '../bridge'
import { Composer, type ComposerHandle, DEFAULT_CHIP_PROMPT, toMessageParts } from './Composer'

const chip: ContextChip = {
  id: 'chip-1',
  kind: 'selection',
  path: 'src/auth.ts',
  ref: 'head',
  side: 'RIGHT',
  startLine: 41,
  endLine: 58,
  text: 'const ttl = 60',
}

function renderComposer(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn<(parts: unknown) => void | Promise<void>>()
  const onStop = vi.fn()
  const ref = createRef<ComposerHandle>()
  const utils = render(
    <Composer
      ref={ref}
      onSend={onSend}
      onStop={onStop}
      streaming={false}
      disabled={false}
      {...over}
    />,
  )
  return { ...utils, onSend, onStop, ref }
}

const textarea = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

describe('toMessageParts', () => {
  it('puts the chips first as data-chip parts, then the text', () => {
    expect(toMessageParts([chip], 'hello')).toEqual([
      { type: 'data-chip', id: 'chip-1', data: chip },
      { type: 'text', text: 'hello' },
    ])
  })
})

describe('Composer', () => {
  it('collects chips from the bridge (deduplicated), shows their exact text, and sends chips + text', async () => {
    const { onSend } = renderComposer()
    act(() => {
      bridge.attachSelection(chip)
      bridge.attachSelection(chip)
    })
    expect(screen.getAllByRole('button', { name: 'src/auth.ts:41–58 @ head' })).toHaveLength(1)
    expect(screen.getByText('1 context chip')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'src/auth.ts:41–58 @ head' }))
    expect(screen.getByTestId('chip-excerpt').textContent).toBe('const ttl = 60')

    fireEvent.change(textarea(), { target: { value: '  Why 60?  ' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith([
      { type: 'data-chip', id: 'chip-1', data: chip },
      { type: 'text', text: 'Why 60?' },
    ])
    await waitFor(() => expect(textarea().value).toBe(''))
    expect(screen.queryByRole('list', { name: 'Attached context' })).toBeNull()
  })

  it('sends chips without text using the default prompt, and removes chips on ×', () => {
    const { onSend } = renderComposer()
    act(() => bridge.attachSelection(chip))
    act(() => bridge.attachSelection({ ...chip, id: 'chip-2', path: 'src/b.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove src/b.ts:41–58 @ head' }))
    expect(screen.getByText('1 context chip')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith([
      { type: 'data-chip', id: 'chip-1', data: chip },
      { type: 'text', text: DEFAULT_CHIP_PROMPT },
    ])
  })

  it('does not send empty drafts; Shift+Enter inserts a newline instead of sending', () => {
    const { onSend } = renderComposer()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    fireEvent.change(textarea(), { target: { value: 'line one' } })
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false)
  })

  it('keeps the draft and shows the error when sending fails', async () => {
    const { onSend } = renderComposer()
    onSend.mockRejectedValueOnce(new Error('No AI provider configured'))
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('No AI provider configured'),
    )
    expect(textarea().value).toBe('hello')
  })

  it('is disabled without a model, and turns Send into Stop while streaming', () => {
    const { onStop, rerender, onSend } = renderComposer({
      disabled: true,
      disabledReason: 'No AI provider configured — add an API key in Setup',
    })
    expect(textarea().disabled).toBe(true)
    expect(textarea().placeholder).toBe('No AI provider configured — add an API key in Setup')
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)

    rerender(<Composer onSend={onSend} onStop={onStop} streaming disabled={false} />)
    expect(textarea().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('exposes insert() so suggestions can fill the draft', () => {
    const { ref } = renderComposer()
    act(() => ref.current?.insert('Any risks or missing tests?'))
    expect(textarea().value).toBe('Any risks or missing tests?')
    expect(document.activeElement).toBe(textarea())
  })
})
