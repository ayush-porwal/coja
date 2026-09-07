import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PanelToggles, panelShortcut } from './PanelToggles'

function renderToggles(overrides: Partial<Parameters<typeof PanelToggles>[0]> = {}) {
  const props = {
    treeOpen: true,
    onToggleTree: vi.fn(),
    aiOpen: true,
    onToggleAi: vi.fn(),
    threadCount: 0,
    chipCount: 0,
    ...overrides,
  }
  render(<PanelToggles {...props} />)
  return props
}

describe('PanelToggles', () => {
  it('renders both toggles pressed while both panels are open', () => {
    renderToggles()
    expect(screen.getByTitle(/Toggle file tree/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTitle(/Toggle AI panel/).getAttribute('aria-pressed')).toBe('true')
  })

  it('marks a toggle unpressed while its panel is collapsed', () => {
    renderToggles({ treeOpen: false })
    expect(screen.getByTitle(/Toggle file tree/).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the shortcut in the tooltip', () => {
    renderToggles()
    expect(screen.getByTitle(`Toggle file tree (${panelShortcut(false)})`)).toBeTruthy()
    expect(screen.getByTitle(`Toggle AI panel (${panelShortcut(true)})`)).toBeTruthy()
  })

  it('badges the collapsed tree toggle with the thread count and the AI toggle with chips', () => {
    renderToggles({ treeOpen: false, aiOpen: false, threadCount: 3, chipCount: 1 })
    // The badge glyph is aria-hidden, so the count must reach the accessible name.
    expect(screen.getByRole('button', { name: /3 comment threads/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /1 context chips/ })).toBeTruthy()
    expect(screen.getByTitle(/Toggle file tree/).textContent).toContain('3')
    expect(screen.getByTitle(/Toggle AI panel/).textContent).toContain('1')
  })

  it('hides badges while the panel is open — the content speaks for itself', () => {
    renderToggles({ treeOpen: true, aiOpen: true, threadCount: 3, chipCount: 1 })
    expect(screen.queryByTitle(/Toggle file tree/)?.textContent).not.toContain('comment threads')
    expect(screen.queryByTitle(/Toggle AI panel/)?.textContent).not.toContain('context chips')
    expect(screen.queryByRole('button', { name: /comment threads/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /context chips/ })).toBeNull()
  })

  it('reports presses', () => {
    const props = renderToggles()
    fireEvent.click(screen.getByTitle(/Toggle file tree/))
    fireEvent.click(screen.getByTitle(/Toggle AI panel/))
    expect(props.onToggleTree).toHaveBeenCalledTimes(1)
    expect(props.onToggleAi).toHaveBeenCalledTimes(1)
  })
})
