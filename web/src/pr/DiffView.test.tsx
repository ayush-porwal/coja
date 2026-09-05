import { describe, expect, it } from 'vitest'
import { toggleCollapsedPath } from './DiffView'

describe('toggleCollapsedPath', () => {
  it('adds and removes paths without mutating the input', () => {
    const initial: ReadonlySet<string> = new Set()
    const collapsed = toggleCollapsedPath(initial, 'src/a.ts')
    expect(initial.size).toBe(0)
    expect(collapsed.has('src/a.ts')).toBe(true)
    const reopened = toggleCollapsedPath(collapsed, 'src/a.ts')
    expect(collapsed.has('src/a.ts')).toBe(true)
    expect(reopened.size).toBe(0)
  })
})
