import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of the `coja` package root (the directory holding package.json).
 * Both `src/` (run via tsx) and `dist/` (built) sit one level below it, so the
 * same relative hop works in either case.
 */
export const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** Where the built web UI lives inside the published package. */
export function resolvePublicDir(): string {
  return path.join(packageRoot, 'public')
}

export function packageVersion(): string {
  const raw = readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  const pkg = JSON.parse(raw) as { version: string }
  return pkg.version
}
