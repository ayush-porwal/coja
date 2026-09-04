import path from 'node:path'
import { ensureDir, resolveDataDir } from './data-dir.js'
import { type Db, openDb } from './db.js'

/** Process-wide dependencies handed to every route module. */
export interface ServerContext {
  dataDir: string
  db: Db
}

export function createContext(opts: { dataDir?: string } = {}): ServerContext {
  const dataDir = ensureDir(opts.dataDir ?? resolveDataDir())
  const db = openDb(path.join(dataDir, 'coja.db'))
  return { dataDir, db }
}
