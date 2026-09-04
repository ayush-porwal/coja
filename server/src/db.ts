import { DatabaseSync } from 'node:sqlite'

/**
 * Local SQLite store. Per the design doc it holds only what GitHub cannot:
 * app settings, the project list, and AI chat history. Review state never
 * lives here.
 */
export type Db = DatabaseSync

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS projects (
     id         TEXT PRIMARY KEY,
     kind       TEXT NOT NULL CHECK (kind IN ('local', 'clone')),
     owner      TEXT NOT NULL,
     repo       TEXT NOT NULL,
     path       TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS chats (
     id            TEXT PRIMARY KEY,
     project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     pr_number     INTEGER NOT NULL,
     title         TEXT,
     model         TEXT NOT NULL,
     messages_json TEXT NOT NULL DEFAULT '[]',
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS chats_by_pr ON chats (project_id, pr_number, updated_at DESC);`,
]

/** Open (or create) the database at `file` (use ':memory:' in tests) and apply migrations. */
export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined
  let version = row?.version ?? 0
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version] as string)
      if (row || version > 0) db.exec(`UPDATE schema_version SET version = ${version + 1}`)
      else db.exec(`INSERT INTO schema_version (version) VALUES (${version + 1})`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return db
}

export const settings = {
  get(db: Db, key: string): string | undefined {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  },
  set(db: Db, key: string, value: string): void {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value)
  },
  delete(db: Db, key: string): void {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  },
}

export function nowIso(): string {
  return new Date().toISOString()
}
