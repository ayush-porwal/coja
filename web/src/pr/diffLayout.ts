/**
 * Layout constants shared between the `<CodeView>` virtualizer and the CSS it
 * renders with, plus the two workarounds the review screen needs for
 * `@pierre/diffs` 1.4.0's CodeView.
 *
 * Why this exists (see docs/design.md §3, "one continuous, lazily rendered
 * scroll"): CodeView never measures a diff's rows when `overflow: 'scroll'`
 * and the file has no annotations (`VirtualizedFileDiff.reconcileHeights`
 * returns before touching the DOM). Its layout is therefore *pure arithmetic*:
 * `diffHeaderHeight + rows × lineHeight + separators + spacing`. Any CSS that
 * changes the real row height (`--diffs-line-height`) or header height silently
 * makes every `item.top` wrong, so jumps and `scrollTo({ type: 'line' })` drift
 * by `rows × delta`. The metrics and the CSS variables below come from the same
 * numbers so they cannot diverge again.
 */
import {
  type CodeViewLayout,
  DEFAULT_CODE_VIEW_FILE_METRICS,
  getFiletypeFromFileName,
  type PostRenderPhase,
  preloadHighlighter,
  type SupportedLanguages,
  type VirtualFileMetrics,
} from '@pierre/diffs'
import type { CSSProperties } from 'react'
import { COJA_DIFF_THEMES as DIFF_THEME } from '../themes/diffTheme'

export { DIFF_THEME }

/** Row height in px. The shadow stylesheet uses `line-height: var(--diffs-line-height, 20px)`. */
export const DIFF_LINE_HEIGHT = 20
/** File header height: the stylesheet's `min-height: calc(1lh + 3 * 8px)` with a 20px `lh`. */
export const DIFF_HEADER_HEIGHT = 44
/** Padding under a file's last row (the library default, `--diffs-gap-*`). */
export const DIFF_SPACING = 8
/** Diff/code font size in px. User preference; the base the row math derives from. */
export const DIFF_FONT_SIZE = 12.5

/**
 * Diff metrics derived from the user's code font size. All row math scales
 * with the font so virtualized rows never overlap when typography changes.
 */
export function diffMetricsForFontSize(
  fontSize: number,
  lineHeightRatio = 1.6,
): {
  lineHeight: number
  itemMetrics: VirtualFileMetrics
  cssVariables: CSSProperties
} {
  const lineHeight = Math.round(fontSize * lineHeightRatio)
  return {
    lineHeight,
    itemMetrics: {
      ...DEFAULT_CODE_VIEW_FILE_METRICS,
      lineHeight,
      diffHeaderHeight: Math.round(lineHeight + 24),
      spacing: DIFF_SPACING,
    },
    cssVariables: {
      '--diffs-font-size': `${fontSize}px`,
      '--diffs-line-height': `${lineHeight}px`,
    } as CSSProperties,
  }
}

/** Default metrics (the historical 12.5px diff font). */
export const DEFAULT_DIFF_METRICS = diffMetricsForFontSize(DIFF_FONT_SIZE)

/** Space around and between items in the CodeView scroller. */
export const DIFF_LAYOUT: CodeViewLayout = { paddingTop: 12, paddingBottom: 12, gap: 12 }

/** Metrics for the default 12.5px diff font, with the heal behavior applied. */
export function diffItemMetrics(layoutEpoch: number): VirtualFileMetrics {
  return layoutEpoch % 2 === 0
    ? { ...DEFAULT_DIFF_METRICS.itemMetrics }
    : { ...DEFAULT_DIFF_METRICS.itemMetrics, paddingTop: 0 }
}

/**
 * True when CodeView just painted an item whose virtual height is zero.
 *
 * That state is a library bug: when an item's first paint is deferred (the
 * highlighter has not attached its grammar yet), the sticky container's
 * ResizeObserver runs `reconcileHeights()` on it before it has rendered, which
 * sets the height to 0 — and, for files without annotations, nothing ever
 * recomputes it. Every real item is at least a header tall, so 0 is
 * unambiguous. The caller answers with a relayout (`diffItemMetrics`).
 */
export function isZeroHeightRender(phase: PostRenderPhase, height: number): boolean {
  return phase !== 'unmount' && !(height > 0)
}

/** Distinct highlighter languages needed for a set of file paths (plain text needs none). */
export function languagesForPaths(paths: readonly string[]): SupportedLanguages[] {
  const languages = new Set<SupportedLanguages>()
  for (const path of paths) {
    const language = getFiletypeFromFileName(path)
    if (language !== 'text' && language !== 'ansi') languages.add(language)
  }
  return [...languages].sort()
}

export const HIGHLIGHTER_PRELOAD_TIMEOUT_MS = 4000

/**
 * Loads the themes and grammars the PR needs before CodeView mounts, so every
 * item's first paint is synchronous (see `isZeroHeightRender`). Never rejects
 * and never waits longer than the timeout: a slow or failed preload only means
 * files highlight (and relayout) a moment later.
 */
export function preloadDiffHighlighter(
  langs: readonly SupportedLanguages[],
  timeoutMs = HIGHLIGHTER_PRELOAD_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  const preload = preloadHighlighter({
    themes: [DIFF_THEME.dark, DIFF_THEME.light],
    langs: [...langs],
  }).catch((error: unknown) => {
    console.warn(
      'coja: highlighter preload failed; diffs render as plain text until it loads',
      error,
    )
  })
  return Promise.race([preload, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
