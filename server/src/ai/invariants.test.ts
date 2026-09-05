import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * String-level guard for the two AI-layer invariants (design.md, "Harness and
 * security model"): PR code never exists as files on disk, and the agent can
 * only read — no shell, no writes, no network, no Forge. Production sources
 * under server/src/ai plus routes/chat.ts are scanned; test files are not,
 * because they author fixture commits (the fixture itself needs `writeFile`,
 * `checkout`, …) and this file names the forbidden strings.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const CHAT_ROUTE = path.resolve(here, '../routes/chat.ts')

const FORBIDDEN = [
  'forge/',
  'node:child_process',
  'child_process',
  'writeFile',
  'mkdtemp',
  'worktree',
  'checkout',
  'fetch(',
] as const

/** Import specifiers the AI layer must never use: the Forge, the file system, process spawning, the network. */
const FORBIDDEN_IMPORTS =
  /forge|node:fs|fs\/promises|node:child_process|node:http|node:https|node:net|undici/

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(here, { recursive: true, withFileTypes: true })
  const own = entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => path.join(e.parentPath, e.name))
  return [...own, CHAT_ROUTE]
}

const rel = (file: string): string => path.relative(path.resolve(here, '../..'), file)

describe('AI layer invariants', () => {
  it('scans the expected modules', async () => {
    const names = (await sourceFiles()).map((f) => path.basename(f))
    expect(names).toEqual(
      expect.arrayContaining([
        'chat-handler.ts',
        'chats.ts',
        'prompt.ts',
        'providers.ts',
        'tools.ts',
        'types.ts',
        'chat.ts',
      ]),
    )
  })

  it.each(FORBIDDEN)('no source file contains %s', async (needle) => {
    for (const file of await sourceFiles()) {
      const text = await readFile(file, 'utf8')
      expect(text.includes(needle), `${rel(file)} contains ${JSON.stringify(needle)}`).toBe(false)
    }
  })

  it('imports nothing from the forge, the file system, child processes or the network', async () => {
    for (const file of await sourceFiles()) {
      const text = await readFile(file, 'utf8')
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '')
      expect(specifiers.length, `${rel(file)} has imports`).toBeGreaterThan(0)
      for (const spec of specifiers) {
        expect(spec, `${rel(file)} imports ${spec}`).not.toMatch(FORBIDDEN_IMPORTS)
      }
      expect(text, `${rel(file)} uses a dynamic import`).not.toMatch(/\bimport\(/)
    }
  })

  it('reads repository content only through git plumbing', async () => {
    const text = await readFile(path.join(here, 'tools.ts'), 'utf8')
    const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '')
    // Everything git-related comes from plumbing.ts; run.ts (the spawner) is never imported directly.
    expect(specifiers.filter((s) => s.includes('/git/'))).toEqual(['../git/plumbing.js'])
  })
})
