import type { ModelInfo } from '@coja/shared/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EffortPicker, ModelPicker } from './ModelPicker'

const models: ModelInfo[] = [
  {
    id: 'chatgpt:gpt-5.5',
    provider: 'chatgpt',
    modelId: 'gpt-5.5',
    label: 'GPT-5.5',
  },
  {
    id: 'custom-deepseek:deepseek-chat',
    provider: 'custom-deepseek',
    modelId: 'deepseek-chat',
    label: 'DeepSeek deepseek-chat',
    providerLabel: 'DeepSeek',
  },
]

const trigger = () => screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement

describe('ModelPicker', () => {
  it('is a disabled pill when no models exist', () => {
    render(<ModelPicker models={[]} value="" onChange={vi.fn()} />)
    expect(trigger().disabled).toBe(true)
    expect(trigger().textContent).toContain('No models')
  })

  it('shows the selected label; opens grouped options with the current one marked', () => {
    render(<ModelPicker models={models} value="chatgpt:gpt-5.5" onChange={vi.fn()} />)
    expect(trigger().textContent).toContain('GPT-5.5')
    fireEvent.click(trigger())
    const listbox = screen.getByRole('listbox', { name: 'Model' })
    const groups = listbox.querySelectorAll('[role="group"]')
    expect(Array.from(groups).map((g) => g.getAttribute('aria-label'))).toEqual([
      'ChatGPT (subscription)',
      'DeepSeek',
    ])
    expect(screen.getByRole('option', { name: 'GPT-5.5' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(
      screen.getByRole('option', { name: 'DeepSeek deepseek-chat' }).getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('selects on click and closes; persists nothing itself (controlled)', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={models} value="chatgpt:gpt-5.5" onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'DeepSeek deepseek-chat' }))
    expect(onChange).toHaveBeenCalledWith('custom-deepseek:deepseek-chat')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('navigates by keyboard: arrows move the highlight, Enter picks it, Escape closes', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={models} value="chatgpt:gpt-5.5" onChange={onChange} />)
    // Open via keyboard, move to the second option, Enter.
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(screen.getByRole('listbox', { name: 'Model' })).toBeDefined()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    const highlighted = screen.getByRole('option', { name: 'DeepSeek deepseek-chat' })
    expect(highlighted.getAttribute('data-highlighted')).toBe('true')
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('custom-deepseek:deepseek-chat')
    expect(screen.queryByRole('listbox')).toBeNull()

    // Escape closes without choosing.
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('EffortPicker', () => {
  const efforts = [
    { effort: 'low', description: 'Fast responses with lighter reasoning' },
    { effort: 'high', description: 'Greater reasoning depth' },
  ]

  it('renders nothing without efforts', () => {
    const { container } = render(<EffortPicker efforts={[]} value={null} onChange={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('shows the current effort and picks another', () => {
    const onChange = vi.fn()
    render(<EffortPicker efforts={efforts} value="low" onChange={onChange} />)
    const pill = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(pill.textContent).toContain('low')
    fireEvent.click(pill)
    fireEvent.click(screen.getByRole('option', { name: /high/ }))
    expect(onChange).toHaveBeenCalledWith('high')
  })
})
