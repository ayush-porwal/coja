import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/api/health')) return Response.json({ ok: true, version: '9.9.9' })
      return new Response('not found', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('renders the heading and the server health line', async () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'coja' })).toBeDefined()
  expect(await screen.findByText('v9.9.9 · server: ok')).toBeDefined()
  expect(fetch).toHaveBeenCalledWith('/api/health')
})
