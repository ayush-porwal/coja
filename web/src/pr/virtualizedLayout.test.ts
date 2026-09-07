import { CodeView, parsePatchFiles, VirtualizedFile, VirtualizedFileDiff } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import { diffMetricsForFontSize } from './diffLayout'

describe('deferred CodeView rendering', () => {
  it.each(['unified', 'split'] as const)(
    'keeps a large %s diff in the scroll range before its first paint',
    (diffStyle) => {
      const patch = [
        'diff --git a/large.ts b/large.ts',
        '--- a/large.ts',
        '+++ b/large.ts',
        '@@ -0,0 +1,1200 @@',
        ...Array.from({ length: 1200 }, (_, i) => `+export const line${i} = ${i}`),
        '',
      ].join('\n')
      const diff = parsePatchFiles(patch)[0]?.files[0]
      expect(diff).toBeDefined()
      if (!diff) return
      const metrics = diffMetricsForFontSize(16, 1.75).itemMetrics
      const view = new CodeView()
      const file = new VirtualizedFileDiff({ diffStyle }, view, metrics)
      const estimate = file.updateCodeViewLayout(diff, 500)
      expect(estimate).toBeGreaterThan(1200 * metrics.lineHeight)
      // ResizeObserver may run before the highlighter has painted this file.
      for (let i = 0; i < 3; i++) {
        expect(file.reconcileHeights()).toBe(false)
        expect(file.getVirtualizedHeight()).toBe(estimate)
      }
      expect(file.getLinePosition(1100, 'additions')?.top).toBeGreaterThan(1000 * metrics.lineHeight)
      file.cleanUp()
      view.cleanUp()
    },
  )

  it('also preserves plain-file and collapsed-header estimates', () => {
    const view = new CodeView()
    const file = new VirtualizedFile({}, view)
    for (const contents of ['one\ntwo\n', '']) {
      const estimate = file.updateCodeViewLayout({ name: 'notes.txt', contents }, 100)
      expect(estimate).toBeGreaterThan(0)
      expect(file.reconcileHeights()).toBe(false)
      expect(file.getVirtualizedHeight()).toBe(estimate)
    }
    file.cleanUp()
    view.cleanUp()
  })
})
