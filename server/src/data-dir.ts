import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Per-user application data directory (SQLite database, app-managed bare
 * clones). Override with `COJA_DATA_DIR` — tests and scratch runs use that.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.COJA_DATA_DIR
  if (override) return path.resolve(override)
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'coja')
    case 'win32':
      return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'coja')
    default:
      return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'coja')
  }
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}
