import type { CodeViewReactOptions } from '@pierre/diffs/react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TYPOGRAPHY_DEFAULTS } from '../typography'
import { DiffView } from './DiffView'
import type { AnnotationMeta } from './mapping'
import { makeDetail } from './testFixtures'

const renderer = vi.hoisted(() => ({
  options: undefined as CodeViewReactOptions<AnnotationMeta, undefined> | undefined,
}))

vi.mock('@pierre/diffs/react', () => ({
  CodeView: ({ options }: { options: typeof renderer.options }) => {
    renderer.options = options
    return null
  },
}))
vi.mock('./diffLayout', async (original) => ({
  ...(await original<typeof import('./diffLayout')>()),
  preloadDiffHighlighter: () => Promise.resolve(),
}))
vi.mock('./hooks', () => ({ useAddComment: () => ({}), useSetViewed: () => ({}) }))
vi.mock('../themes/ThemeContext', () => ({
  useTheme: () => ({
    appearance: 'dark',
    palette: { id: 'mulberry' },
    typography: { ...TYPOGRAPHY_DEFAULTS, codeSize: 16, codeLineHeight: 1.75 },
  }),
}))

afterEach(() => vi.unstubAllGlobals())

describe('DiffView layout recovery', () => {
  it('invalidates layout after a zero-height render while preserving custom typography', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const detail = makeDetail({ threads: [] })
    const path = detail.files[0]?.path as string
    render(
      <DiffView
        projectId="layout-test"
        number={1}
        detail={detail}
        gitFiles={[]}
        diffs={new Map([[path, new Error('placeholder')]])}
        loaded={1}
        failed={1}
        total={1}
        fetchStatus={undefined}
        fetchError={null}
        onRetryFetch={() => {}}
        diffStyle="unified"
        scrollRequest={null}
      />,
    )
    await waitFor(() => expect(renderer.options).toBeDefined())
    const initial = renderer.options?.itemMetrics
    expect(initial).toMatchObject({ lineHeight: 28, diffHeaderHeight: 52 })
    const reportZero = () =>
      renderer.options?.onPostRender?.(document.createElement('div'), {} as never, 'mount', {
        item: { id: path },
        height: 0,
        version: 1,
      } as never)
    act(() => {
      reportZero()
      reportZero()
    })
    expect(frames).toHaveLength(1)
    act(() => frames.shift()?.(0))
    expect(renderer.options?.itemMetrics).not.toEqual(initial)
    expect(renderer.options?.itemMetrics).toMatchObject({
      lineHeight: 28,
      diffHeaderHeight: 52,
      paddingTop: 0,
    })
    // A persistent bad render cannot cause an endless recovery loop.
    act(reportZero)
    expect(frames).toHaveLength(0)
  })
})
