import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandLoader } from './BrandLoader'

const runtime = vi.hoisted(() => ({ loadAnimation: vi.fn() }))
vi.mock('lottie-web', () => ({ default: runtime }))

let motionChanged: ((event: { matches: boolean }) => void) | undefined
function motion(reduced = false) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: unknown) => {
      motionChanged = listener as typeof motionChanged
    },
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }))
}
function player() {
  const listeners = new Map<string, () => void>()
  return {
    isLoaded: false,
    currentFrame: 120,
    destroy: vi.fn(),
    setSpeed: vi.fn(),
    goToAndPlay: vi.fn(),
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    emit: (event: string) => listeners.get(event)?.(),
  }
}
const props = {
  paletteId: 'grove',
  appearance: 'dark',
  size: 'medium',
  label: 'Loading chat…',
} as const

beforeEach(() => {
  runtime.loadAnimation.mockReset()
  motionChanged = undefined
  motion()
})

describe('BrandLoader', () => {
  it('uses a matching SVG without fetching animation data under reduced motion', () => {
    motion(true)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(<BrandLoader {...props} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/brand/coja/themes/grove/dark/cj.svg',
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(fetcher).not.toHaveBeenCalled()
    expect(runtime.loadAnimation).not.toHaveBeenCalled()
  })

  it('keeps the still visible until ready, preserves progress on theme change, and updates speed without recreating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const first = player(),
      second = player()
    runtime.loadAnimation.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const view = render(<BrandLoader {...props} />)
    await waitFor(() => expect(runtime.loadAnimation).toHaveBeenCalledTimes(1))
    const still = () => view.container.querySelector('img') as HTMLImageElement
    expect(still().style.visibility).toBe('visible')
    act(() => first.emit('DOMLoaded'))
    expect(still().style.visibility).toBe('hidden')
    view.rerender(<BrandLoader {...props} speed={2} />)
    expect(first.setSpeed).toHaveBeenLastCalledWith(2)
    expect(runtime.loadAnimation).toHaveBeenCalledTimes(1)
    view.rerender(<BrandLoader {...props} paletteId="iris" speed={2} />)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(still().getAttribute('src')).toContain('/iris/dark/cj.svg')
    await waitFor(() => expect(runtime.loadAnimation).toHaveBeenCalledTimes(2))
    act(() => second.emit('DOMLoaded'))
    expect(second.goToAndPlay).toHaveBeenCalledWith(120, true)
    act(() => motionChanged?.({ matches: true }))
    expect(second.destroy).toHaveBeenCalledTimes(1)
    expect(still().style.visibility).toBe('visible')
  })

  it('recovers from a failed asset when switching themes', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetcher)
    const animation = player()
    runtime.loadAnimation.mockReturnValue(animation)
    const view = render(<BrandLoader {...props} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(view.container.querySelector('img')?.getAttribute('src')).toMatch(/\.svg$/)
    view.rerender(<BrandLoader {...props} appearance="light" />)
    await waitFor(() => expect(runtime.loadAnimation).toHaveBeenCalledTimes(1))
    act(() => animation.emit('DOMLoaded'))
    expect((view.container.querySelector('img') as HTMLImageElement).style.visibility).toBe(
      'hidden',
    )
    act(() => animation.emit('data_failed'))
    expect((view.container.querySelector('img') as HTMLImageElement).style.visibility).toBe(
      'visible',
    )
    expect(animation.destroy).toHaveBeenCalledTimes(1)
  })

  it('aborts pending work and never creates a player after unmount', async () => {
    let complete: ((response: unknown) => void) | undefined
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const view = render(<BrandLoader {...props} />)
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => complete?.({ ok: true, json: async () => ({}) }))
    expect(runtime.loadAnimation).not.toHaveBeenCalled()
  })
})
