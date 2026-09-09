import { expect, it } from 'vitest'
import { prFilterKey } from './hooks'

it('shares query cache keys for implicit and explicit open filters', () => {
  expect(prFilterKey({ author: 'alice', state: 'open' })).toBe(prFilterKey({ author: 'alice' }))
  expect(prFilterKey({ author: 'alice', state: 'closed' })).not.toBe(
    prFilterKey({ author: 'alice' }),
  )
})
