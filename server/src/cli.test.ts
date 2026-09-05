import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/**
 * `cli.ts` runs `main()` on import, so it is exercised as a child process the
 * way `bin/coja.js` runs it. Every case here exits inside `parseCli` (or on
 * `--version`), before git is probed, the keychain is touched or a socket is
 * bound.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, 'cli.ts')
const run = promisify(execFile)

interface Exit {
  code: number
  stdout: string
  stderr: string
}

async function coja(...args: string[]): Promise<Exit> {
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: path.resolve(here, '..'),
      timeout: 60_000,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as Partial<Exit> & { code?: number | string }
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    }
  }
}

describe('coja CLI', () => {
  it('refuses wildcard binds with exit code 2 and points at a concrete address', async () => {
    for (const host of ['0.0.0.0', '::', '[::]']) {
      const res = await coja('--host', host, '--no-open')
      expect(res.code, host).toBe(2)
      expect(res.stderr, host).toContain(`--host "${host}" is a wildcard bind`)
      expect(res.stderr, host).toContain('bind to a concrete address, e.g. --host 192.168.1.5')
      expect(res.stderr, host).toContain('coja is designed for loopback')
      expect(res.stderr, host).toContain('Usage: coja')
    }
  }, 90_000)

  it('still answers --version (arguments that pass parsing are unaffected)', async () => {
    const res = await coja('--version')
    expect(res.code).toBe(0)
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  }, 60_000)
})
