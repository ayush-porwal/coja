// @vitest-environment node
import { DEFAULT_CODE_VIEW_FILE_METRICS } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import {
  DIFF_FONT_SIZE,
  DIFF_SPACING,
  diffItemMetrics,
  diffMetricsForFontSize,
  isZeroHeightRender,
  languagesForPaths,
} from './diffLayout'

describe('diffItemMetrics', () => {
  it('pins the metrics the CSS depends on and keeps the CodeView render batch size', () => {
    const metrics = diffMetricsForFontSize(DIFF_FONT_SIZE).itemMetrics
    expect(metrics.lineHeight).toBe(Math.round(DIFF_FONT_SIZE * 1.6))
    expect(metrics.spacing).toBe(DIFF_SPACING)
    expect(metrics.hunkLineCount).toBe(DEFAULT_CODE_VIEW_FILE_METRICS.hunkLineCount)
  })

  it('scales line height and header height with the code font size', () => {
    const base = diffMetricsForFontSize(DIFF_FONT_SIZE).itemMetrics
    const bigger = diffMetricsForFontSize(DIFF_FONT_SIZE + 4).itemMetrics
    expect(bigger.lineHeight).toBeGreaterThan(base.lineHeight)
    expect(bigger.diffHeaderHeight).toBeGreaterThan(base.diffHeaderHeight)
  })

  it('alternates a key CodeView compares, without changing the effective layout', () => {
    const even = diffItemMetrics(0)
    const odd = diffItemMetrics(1)
    // CodeView's setOptions compares itemMetrics key by key (`objA[key] !== objB[key]`).
    expect('paddingTop' in even).toBe(false)
    expect(odd.paddingTop).toBe(0) // the library default when a file header is shown
    expect({ ...odd, paddingTop: undefined }).toEqual({ ...even, paddingTop: undefined })
    expect(diffItemMetrics(2)).toEqual(even)
    expect(diffItemMetrics(3)).toEqual(odd)
  })

  it('returns a fresh object per call so a stale reference is never mutated', () => {
    expect(diffItemMetrics(0)).not.toBe(diffItemMetrics(0))
  })
})

describe('isZeroHeightRender', () => {
  it('flags a mounted or updated item with no virtual height', () => {
    expect(isZeroHeightRender('mount', 0)).toBe(true)
    expect(isZeroHeightRender('update', 0)).toBe(true)
    expect(isZeroHeightRender('mount', Number.NaN)).toBe(true)
  })

  it('ignores healthy items and unmounts', () => {
    const { itemMetrics } = diffMetricsForFontSize(DIFF_FONT_SIZE)
    expect(isZeroHeightRender('mount', itemMetrics.diffHeaderHeight)).toBe(false)
    expect(isZeroHeightRender('update', 1)).toBe(false)
    expect(isZeroHeightRender('unmount', 0)).toBe(false)
  })
})

describe('languagesForPaths', () => {
  it('maps the fixture PR to its distinct grammars, sorted and without plain text', () => {
    expect(
      languagesForPaths([
        'docs/architecture.md',
        'src/auth/session.ts',
        'src/auth/session.test.ts',
        'src/auth/bearer.ts',
        'src/util/timezones.ts',
        'package.json',
        'LICENSE',
      ]),
    ).toEqual(['json', 'markdown', 'typescript'])
  })

  it('returns nothing for plain-text-only or empty inputs', () => {
    expect(languagesForPaths(['notes.txt', ''])).toEqual([])
    expect(languagesForPaths([])).toEqual([])
  })
})
