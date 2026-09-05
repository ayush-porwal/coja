import type { ChangedFile } from '@coja/shared/api'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { makeDetail } from './testFixtures'
import type { CenterSelection } from './types'

const OVERVIEW: CenterSelection = { kind: 'overview' }

function renderSidebar(selection: CenterSelection, files: ChangedFile[] = makeDetail().files) {
  const onSelectFile = vi.fn()
  const view = render(
    <Sidebar
      files={files}
      threads={[]}
      conversationCount={0}
      selection={selection}
      onSelectOverview={() => {}}
      onSelectFile={onSelectFile}
    />,
  )
  return { ...view, onSelectFile }
}

/** The tree renders into an open shadow root; rows carry `data-item-path`. */
async function findRow(container: HTMLElement, path: string): Promise<HTMLElement> {
  const host = container.querySelector('file-tree-container')
  if (!(host instanceof HTMLElement)) throw new Error('file tree host not rendered')
  return waitFor(() => {
    const row = host.shadowRoot?.querySelector(`[data-item-path="${path}"]`)
    if (!(row instanceof HTMLElement)) throw new Error(`row for ${path} not rendered yet`)
    return row
  })
}

describe('Sidebar', () => {
  it('opens a file on the very first press, before any tree click is delivered', async () => {
    const { container, onSelectFile } = renderSidebar(OVERVIEW)
    const row = await findRow(container, 'src/auth/session.ts')

    fireEvent.pointerDown(row, { button: 0, pointerType: 'mouse' })

    expect(onSelectFile).toHaveBeenCalledTimes(1)
    expect(onSelectFile).toHaveBeenCalledWith('src/auth/session.ts')
  })

  it('leaves modifier and touch presses, and directory rows, to the tree', async () => {
    const { container, onSelectFile } = renderSidebar(OVERVIEW)
    const row = await findRow(container, 'src/auth/session.ts')

    fireEvent.pointerDown(row, { button: 0, pointerType: 'mouse', shiftKey: true })
    fireEvent.pointerDown(row, { button: 0, pointerType: 'touch' })
    fireEvent.pointerDown(row, { button: 2, pointerType: 'mouse' })
    const directory = await findRow(container, 'src/auth/')
    fireEvent.pointerDown(directory, { button: 0, pointerType: 'mouse' })

    expect(onSelectFile).not.toHaveBeenCalled()
  })

  it('still opens files through the tree selection (keyboard, click) without double-firing', async () => {
    const { container, onSelectFile, rerender } = renderSidebar(OVERVIEW)
    const row = await findRow(container, 'src/auth/audit.ts')

    fireEvent.click(row)
    expect(onSelectFile).toHaveBeenCalledTimes(1)
    expect(onSelectFile).toHaveBeenCalledWith('src/auth/audit.ts')

    // Once the screen shows that file, neither a press nor the tree's selection re-opens it.
    rerender(
      <Sidebar
        files={makeDetail().files}
        threads={[]}
        conversationCount={0}
        selection={{ kind: 'file', path: 'src/auth/audit.ts' }}
        onSelectOverview={() => {}}
        onSelectFile={onSelectFile}
      />,
    )
    fireEvent.pointerDown(row, { button: 0, pointerType: 'mouse' })
    fireEvent.click(row)
    expect(onSelectFile).toHaveBeenCalledTimes(1)
  })
})
