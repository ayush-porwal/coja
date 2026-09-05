import type { FetchStatus, FileDiffResponse } from '@coja/shared/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { blobUrl, DIFF_CONCURRENCY, diffUrl, useFetchStatus, useFileDiffs } from './hooks'

vi.mock('../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)
const mockedPost = vi.mocked(api.post)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function pathOf(url: string): string {
  const path = new URL(url, 'http://localhost').searchParams.get('path')
  if (path === null) throw new Error(`no path in ${url}`)
  return path
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`)
  return value
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
})

describe('urls', () => {
  it('builds the diff and blob URLs with encoded query params', () => {
    expect(diffUrl('p 1', 7, 'src/a b.ts', 'src/old.ts')).toBe(
      '/api/projects/p%201/prs/7/diff?path=src%2Fa+b.ts&previousPath=src%2Fold.ts',
    )
    expect(diffUrl('p', 7, 'src/a.ts')).toBe('/api/projects/p/prs/7/diff?path=src%2Fa.ts')
    expect(blobUrl('p', 7, 'head', 'src/a.ts', 3, 9)).toBe(
      '/api/projects/p/prs/7/blob?ref=head&path=src%2Fa.ts&start=3&end=9',
    )
  })
})

describe('useFetchStatus', () => {
  it('POSTs once on mount, then polls with GET until ready', async () => {
    const calls: string[] = []
    mockedPost.mockImplementation(async () => {
      calls.push('POST')
      return { state: 'fetching' } satisfies FetchStatus
    })
    let gets = 0
    mockedGet.mockImplementation(async () => {
      calls.push('GET')
      gets += 1
      return (
        gets < 2 ? { state: 'fetching' } : { state: 'ready', headOid: 'abc' }
      ) satisfies FetchStatus
    })

    const { result } = renderHook(() => useFetchStatus('p', 1, 5), { wrapper })
    await waitFor(() => expect(result.current.status?.state).toBe('ready'))
    expect(calls[0]).toBe('POST')
    expect(calls.slice(1).every((c) => c === 'GET')).toBe(true)
    expect(calls.filter((c) => c === 'POST')).toHaveLength(1)

    // Polling stops once ready.
    const settled = calls.length
    await new Promise((r) => setTimeout(r, 40))
    expect(calls.length).toBe(settled)
  })

  it('retry() re-POSTs after a failed start', async () => {
    mockedPost.mockRejectedValueOnce(new Error('gh not authenticated'))
    mockedPost.mockResolvedValueOnce({ state: 'ready' } satisfies FetchStatus)

    const { result } = renderHook(() => useFetchStatus('p', 1, 5), { wrapper })
    await waitFor(() => expect(result.current.error?.message).toBe('gh not authenticated'))
    result.current.retry()
    await waitFor(() => expect(result.current.status?.state).toBe('ready'))
    expect(mockedPost).toHaveBeenCalledTimes(2)
    expect(mockedGet).not.toHaveBeenCalled()
  })
})

describe('useFileDiffs', () => {
  it('loads patches in file order with bounded concurrency and surfaces errors per file', async () => {
    const pending = new Map<
      string,
      { resolve(v: FileDiffResponse): void; reject(e: Error): void }
    >()
    const requested: string[] = []
    mockedGet.mockImplementation(
      (url: string) =>
        new Promise<FileDiffResponse>((resolve, reject) => {
          const path = pathOf(url)
          requested.push(path)
          pending.set(path, { resolve, reject })
        }) as Promise<never>,
    )
    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((path) => ({ path }))
    const { result } = renderHook(() => useFileDiffs('p', 1, files, true, 'rev1'), { wrapper })

    expect(result.current.total).toBe(6)
    await waitFor(() => expect(requested).toHaveLength(DIFF_CONCURRENCY))
    expect(requested).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.diffs.get('a')).toBe('loading')

    const response = (path: string): FileDiffResponse => ({
      path,
      patch: `patch ${path}`,
      binary: false,
      tooLarge: false,
    })
    must(pending.get('a'), 'a').resolve(response('a'))
    await waitFor(() => expect(result.current.diffs.get('a')).toEqual(response('a')))
    await waitFor(() => expect(requested).toEqual(['a', 'b', 'c', 'd', 'e']))
    expect(result.current.loaded).toBe(1)

    // Failures (after the single retry) become Error entries and free the slot.
    must(pending.get('b'), 'b').reject(new Error('boom'))
    await waitFor(() => expect(requested.filter((p) => p === 'b')).toHaveLength(2), {
      timeout: 3000,
    })
    must(pending.get('b'), 'b retry').reject(new Error('boom again'))
    await waitFor(() => expect(result.current.diffs.get('b')).toBeInstanceOf(Error), {
      timeout: 3000,
    })
    expect(result.current.failed).toBe(1)
    await waitFor(() => expect(requested).toContain('f'))

    for (const path of ['c', 'd', 'e', 'f']) must(pending.get(path), path).resolve(response(path))
    await waitFor(() => expect(result.current.loaded).toBe(6))
    expect(result.current.diffs.get('f')).toEqual(response('f'))
  })

  it('does not request anything while disabled but still reports the total', async () => {
    const files = [{ path: 'a' }, { path: 'b' }]
    const { result } = renderHook(() => useFileDiffs('p', 1, files, false), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(2))
    expect(result.current.diffs.get('a')).toBe('loading')
    expect(mockedGet).not.toHaveBeenCalled()
  })
})
