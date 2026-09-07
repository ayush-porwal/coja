import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { bridge } from './bridge'
import { PullRequestScreen } from './PullRequestScreen'

vi.mock('../themes/ThemeContext', () => ({
  useTheme: () => ({ palette: { id: 'mulberry' }, appearance: 'dark' }),
}))
vi.mock('./hooks', () => ({
  usePullRequest: () => ({
    data: {
      title: 'Sample change',
      files: [{ path: 'sample.ts' }],
      threads: [],
      conversation: [],
      pendingReview: null,
    },
  }),
  useFetchStatus: () => ({ status: { state: 'ready' } }),
  useGitFiles: () => ({ data: [] }),
  useFileDiffs: () => ({ diffs: [], loaded: 1, failed: 0, total: 1 }),
}))
vi.mock('./TopBar', () => ({
  TopBar: (props: {
    treeOpen: boolean
    aiOpen: boolean
    onToggleTree(): void
    onToggleAi(): void
    onConversation(): void
  }) => (
    <header>
      <button type="button" aria-pressed={props.treeOpen} onClick={props.onToggleTree}>
        Files
      </button>
      <button type="button" aria-pressed={props.aiOpen} onClick={props.onToggleAi}>
        Chat
      </button>
      <button type="button" onClick={props.onConversation}>
        Conversation
      </button>
    </header>
  ),
}))
vi.mock('./Sidebar', () => ({
  Sidebar: ({ onSelectFile }: { onSelectFile(path: string): void }) => (
    <button type="button" onClick={() => onSelectFile('sample.ts')}>
      sample.ts
    </button>
  ),
}))
vi.mock('./ai/AiPanel', () => ({ AiPanel: () => <textarea aria-label="Message" /> }))
vi.mock('./Overview', () => ({ Overview: () => <p>PR overview</p> }))
vi.mock('./DiffView', () => ({ DiffView: () => <p>File diff</p> }))
vi.mock('./ReviewDialog', () => ({ ReviewDialog: () => null }))

function setup(compact: boolean) {
  localStorage.clear()
  let resize: (() => void) | undefined
  const media = {
    matches: compact,
    addEventListener: (_: string, listener: () => void) => {
      resize = listener
    },
    removeEventListener: vi.fn(),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  render(
    <MemoryRouter initialEntries={['/p/project/pr/1']}>
      <Routes>
        <Route path="/p/:projectId/pr/:number" element={<PullRequestScreen />} />
      </Routes>
    </MemoryRouter>,
  )
  return (matches: boolean) =>
    act(() => {
      media.matches = matches
      resize?.()
    })
}

describe('responsive review panes', () => {
  it('shows one pane at a time on phones and returns to the diff after selecting a file', () => {
    setup(true)
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByRole('complementary', { name: 'File tree' })).toBeDefined()
    expect(screen.queryByRole('main')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(screen.getByRole('complementary', { name: 'AI panel' })).toBeDefined()
    expect(screen.queryByRole('complementary', { name: 'File tree' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Draft kept' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    fireEvent.click(screen.getByRole('button', { name: 'sample.ts' }))
    expect(screen.getByRole('main').textContent).toBe('File diff')
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe(
      'Draft kept',
    )
  })

  it('opens attached context in chat and takes citations back to the main pane with focus', () => {
    setup(true)
    act(() =>
      bridge.attachSelection({
        id: 'chip',
        kind: 'selection',
        path: 'sample.ts',
        ref: 'head',
        side: 'RIGHT',
        startLine: 1,
        endLine: 1,
        text: 'sample',
      }),
    )
    const message = screen.getByRole('textbox', { name: 'Message' })
    message.focus()
    act(() => bridge.scrollToLine({ path: 'sample.ts', line: 1 }))
    expect(screen.getByRole('main')).toBe(document.activeElement)
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('keeps desktop panel preferences independent of phone navigation', () => {
    const resize = setup(false)
    expect(screen.getAllByRole('complementary')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    resize(true)
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    resize(false)
    expect(screen.queryByRole('complementary', { name: 'File tree' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'AI panel' })).toBeDefined()
  })
})
