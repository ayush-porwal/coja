import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/queryClient'
import { installMockApi } from '../test/mockApi'
import { DirectoryPicker } from './DirectoryPicker'

const HOME = '/Users/you'

/** Standard filesystem for the mock server. */
function installFs() {
  return installMockApi({
    'GET /api/fs/home': { home: HOME },
    'GET /api/fs/dirs': ({ url }) => {
      const path = url.searchParams.get('path') ?? ''
      const prefix = (url.searchParams.get('prefix') ?? '').toLowerCase()
      const tree: Record<string, { name: string; hasGit: boolean }[]> = {
        [HOME]: [
          { name: 'code', hasGit: false },
          { name: 'Documents', hasGit: false },
          { name: 'my-repo', hasGit: true },
        ],
        [`${HOME}/code`]: [
          { name: 'coja', hasGit: true },
          { name: 'Dotfiles', hasGit: true },
          { name: 'tools', hasGit: false },
        ],
      }
      const dirs = (tree[path] ?? []).filter((d) => d.name.toLowerCase().startsWith(prefix))
      return { path, parent: path === '/' ? null : '/', dirs, total: dirs.length, truncated: false }
    },
  })
}

/** Stateful harness: the picker is controlled, so onChange must feed back into value. */
function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return <DirectoryPicker id="project-path" value={value} onChange={setValue} />
}

function renderPicker(initial = '') {
  render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  )
}

describe('DirectoryPicker', () => {
  it('opens on Browse, starts at the last-used parent, and lists directories with repo badges', async () => {
    localStorage.setItem('coja.lastProjectParent', JSON.stringify(`${HOME}/code`))
    const mock = installFs()
    renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    expect(await screen.findByRole('listbox')).toBeDefined()
    await screen.findByText('coja')
    expect(screen.getByText('Dotfiles')).toBeDefined()
    expect(screen.getByText('tools')).toBeDefined()
    // Repo badges on the two git clones.
    expect(screen.getAllByText('repo')).toHaveLength(2)
    // The last-used parent was the listing root, not home.
    const listing = mock.calls.find((c) => c.url.startsWith('/api/fs/dirs?'))
    expect(listing?.url).toContain(encodeURIComponent(`${HOME}/code`))
    localStorage.removeItem('coja.lastProjectParent')
  })

  it('falls back to home when no parent was stored', async () => {
    localStorage.removeItem('coja.lastProjectParent')
    installFs()
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('my-repo')
    expect(screen.getByText('Documents')).toBeDefined()
  })

  it('filters server-side as you type (debounced)', async () => {
    const mock = installFs()
    renderPicker(`${HOME}/code/`)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('coja')

    const input = screen.getByRole('combobox', { name: '' })
    fireEvent.change(input, { target: { value: `${HOME}/code/dot` } })
    await waitFor(() =>
      expect(
        mock.calls.some((c) => c.url.includes(`/api/fs/dirs?`) && c.url.includes('prefix=dot')),
      ).toBe(true),
    )
    await screen.findByText('Dotfiles')
    expect(screen.queryByText('tools')).toBeNull()
  })

  it('descends on row click by rewriting the input with a trailing slash', async () => {
    installFs()
    renderPicker(`${HOME}/`)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('code')
    fireEvent.click(screen.getByText('code'))
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe(`${HOME}/code/`)
      expect(screen.getByText('coja')).toBeDefined() // now listing the descended folder
    })
  })

  it('commits a repo folder from its Use button and remembers the parent', async () => {
    installFs()
    renderPicker(`${HOME}/`)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('my-repo')
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    await waitFor(() =>
      expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe(`${HOME}/my-repo`),
    )
    expect(screen.queryByRole('listbox')).toBeNull() // the popover closed
    expect(localStorage.getItem('coja.lastProjectParent')).toBe(JSON.stringify(HOME))
  })

  it('uses the currently listed folder from the footer button', async () => {
    installFs()
    renderPicker(`${HOME}/code/`)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('coja')
    fireEvent.click(screen.getByRole('button', { name: /Use this folder/ }))
    await waitFor(() =>
      expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe(`${HOME}/code`),
    )
  })

  it('navigates with the keyboard: arrows move the highlight, Enter descends', async () => {
    installFs()
    renderPicker(`${HOME}/`)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText('code')
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // The first entry is code (no repo) → Enter descends instead of choosing.
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('coja', undefined, { timeout: 3000 })
  })

  it('shows the truncation hint when the listing is capped', async () => {
    installMockApi({
      'GET /api/fs/home': { home: HOME },
      'GET /api/fs/dirs': { path: HOME, parent: '/', dirs: [], total: 900, truncated: true },
    })
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByText(/keep typing to narrow/)
  })
})
