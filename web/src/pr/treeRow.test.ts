import { describe, expect, it } from 'vitest'
import { fileRowPathFromComposedPath, isPlainPrimaryPress } from './treeRow'

function row(itemType: 'file' | 'folder', itemPath: string): HTMLElement {
  const el = document.createElement('button')
  el.dataset.type = 'item'
  el.dataset.itemType = itemType
  el.dataset.itemPath = itemPath
  return el
}

describe('fileRowPathFromComposedPath', () => {
  it('finds the file row above the pressed node, ignoring inner spans', () => {
    const button = row('file', 'src/util/timezones.ts')
    const label = document.createElement('span')
    button.appendChild(label)
    expect(fileRowPathFromComposedPath([label, button, document.body, document, window])).toBe(
      'src/util/timezones.ts',
    )
  })

  it('returns null for directory rows and for presses outside any row', () => {
    expect(fileRowPathFromComposedPath([row('folder', 'src/'), document.body])).toBeNull()
    expect(fileRowPathFromComposedPath([document.createElement('div'), document.body])).toBeNull()
    expect(fileRowPathFromComposedPath([])).toBeNull()
  })

  it('does not mistake other data-type elements for rows', () => {
    const header = document.createElement('div')
    header.dataset.type = 'header-slot'
    header.dataset.itemPath = 'src/a.ts'
    expect(fileRowPathFromComposedPath([header])).toBeNull()
  })
})

describe('isPlainPrimaryPress', () => {
  const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

  it('accepts a primary mouse or pen press without modifiers', () => {
    expect(isPlainPrimaryPress({ ...plain, pointerType: 'mouse' })).toBe(true)
    expect(isPlainPrimaryPress({ ...plain, pointerType: 'pen' })).toBe(true)
    expect(isPlainPrimaryPress(plain)).toBe(true)
  })

  it('leaves modifier, secondary and touch presses to the tree', () => {
    expect(isPlainPrimaryPress({ ...plain, shiftKey: true })).toBe(false)
    expect(isPlainPrimaryPress({ ...plain, metaKey: true })).toBe(false)
    expect(isPlainPrimaryPress({ ...plain, ctrlKey: true })).toBe(false)
    expect(isPlainPrimaryPress({ ...plain, altKey: true })).toBe(false)
    expect(isPlainPrimaryPress({ ...plain, button: 2 })).toBe(false)
    expect(isPlainPrimaryPress({ ...plain, pointerType: 'touch' })).toBe(false)
  })
})
