import { describe, expect, it } from 'vitest'
import { openDb, settings } from './db.js'

describe('db', () => {
  it('migrates an empty database and round-trips settings', () => {
    const db = openDb(':memory:')
    expect(settings.get(db, 'x')).toBeUndefined()
    settings.set(db, 'x', '1')
    settings.set(db, 'x', '2')
    expect(settings.get(db, 'x')).toBe('2')
    settings.delete(db, 'x')
    expect(settings.get(db, 'x')).toBeUndefined()
    const v = db.prepare('SELECT version FROM schema_version').get() as { version: number }
    expect(v.version).toBe(1)
    db.close()
  })
})
