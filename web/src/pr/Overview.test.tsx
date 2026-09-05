import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Overview } from './Overview'
import { makeDetail } from './testFixtures'

describe('Overview', () => {
  it('renders the description HTML, commits and conversation', () => {
    render(<Overview detail={makeDetail()} />)

    // Title and meta
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Session rotation with audit log',
    )
    expect(screen.getByText('feature/session-rotation')).toBeDefined()

    // Description: GitHub HTML is rendered, not escaped
    const description = screen.getByRole('region', { name: 'Description' })
    expect(within(description).getByText('sessions').tagName).toBe('STRONG')
    expect(within(description).getByText('adds audit log').tagName).toBe('LI')

    // Commits
    const commits = screen.getByRole('region', { name: /Commits/ })
    const link = within(commits).getByRole('link', { name: 'aaaaaaa' })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/commit/aaaaaaa')
    expect(within(commits).getByText('Rotate sessions on login')).toBeDefined()
    expect(within(commits).getByText(/Someone Else/)).toBeDefined()

    // Conversation: a comment and a review with its state badge, oldest first
    const conversation = screen.getByRole('region', { name: /Conversation/ })
    const entries = within(conversation).getAllByRole('article')
    expect(entries).toHaveLength(2)
    expect(entries[0]?.textContent).toContain('reviewer')
    expect(entries[0]?.textContent).toContain('commented')
    expect(within(entries[1] as HTMLElement).getByText('approved')).toBeDefined()
    expect(entries[1]?.textContent).toContain('2 inline comments')
  })

  it('shows placeholders for an empty description and conversation', () => {
    render(<Overview detail={makeDetail({ bodyHTML: '', conversation: [], commits: [] })} />)
    expect(screen.getByText('No description provided.')).toBeDefined()
    expect(screen.getByText('No conversation yet.')).toBeDefined()
    expect(screen.getByText('No commits.')).toBeDefined()
  })
})
