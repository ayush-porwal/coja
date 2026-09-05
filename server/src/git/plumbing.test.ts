import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../routes/http.js'
import {
  blame,
  blobInfo,
  cloneBare,
  diff,
  diffNameStatus,
  fetch,
  GH_CREDENTIAL_HELPER,
  grep,
  isBareRepo,
  isGitRepo,
  log,
  lsTree,
  mergeBase,
  remoteUrl,
  revParse,
  showFile,
  topLevel,
} from './plumbing.js'
import { GitError, runGit } from './run.js'
import {
  APP_TS_HEAD,
  createFixture,
  FIXTURE_AUTHOR_DATE,
  FIXTURE_REMOTE_URL,
  type Fixture,
} from './test-fixture.js'

let fx: Fixture
let scratch: string

beforeAll(async () => {
  fx = await createFixture()
  scratch = await mkdtemp(path.join(os.tmpdir(), 'coja-plumbing-'))
})

afterAll(async () => {
  await fx.cleanup()
  await rm(scratch, { recursive: true, force: true })
})

describe('repository facts', () => {
  it('isGitRepo / isBareRepo / topLevel', async () => {
    expect(await isGitRepo(fx.localDir)).toBe(true)
    expect(await isGitRepo(fx.originDir)).toBe(true)
    expect(await isGitRepo(fx.root)).toBe(false)
    expect(await isGitRepo(path.join(fx.root, 'does-not-exist'))).toBe(false)
    expect(await isBareRepo(fx.originDir)).toBe(true)
    expect(await isBareRepo(fx.localDir)).toBe(false)
    expect(await topLevel(fx.originDir)).toBeNull()
    expect(path.basename((await topLevel(path.join(fx.localDir, 'src'))) ?? '')).toBe('local')
  })

  it('remoteUrl returns the configured URL, not the insteadOf rewrite', async () => {
    expect(await remoteUrl(fx.localDir)).toBe(FIXTURE_REMOTE_URL)
    expect(await remoteUrl(fx.localDir, 'upstream')).toBeNull()
  })

  it('revParse resolves commits and returns null for unknown refs', async () => {
    expect(await revParse(fx.originDir, 'main')).toBe(fx.mainOid)
    expect(await revParse(fx.originDir, 'refs/pull/1/head')).toBe(fx.headOid)
    expect(await revParse(fx.originDir, 'refs/nope')).toBeNull()
    expect(await revParse(fx.originDir, `${fx.headOid}:src/app.ts`)).toBeNull() // a blob, not a commit
    await expect(revParse(fx.originDir, '--all')).rejects.toThrow(HttpError)
  })

  it('mergeBase finds the branch point, not the moved-on main tip', async () => {
    expect(await mergeBase(fx.originDir, 'main', 'refs/pull/1/head')).toBe(fx.baseOid)
    expect(fx.baseOid).not.toBe(fx.mainOid)
  })
})

describe('fetch', () => {
  it('fetches refs/pull/1/head and a base oid into namespaced refs without touching the checkout', async () => {
    const before = await snapshot(fx)
    await fetch(fx.localDir, 'origin', [
      '+refs/pull/1/head:refs/coja/pull/1/head',
      `+${fx.baseOid}:refs/coja/pull/1/base`,
    ])
    expect(await revParse(fx.localDir, 'refs/coja/pull/1/head')).toBe(fx.headOid)
    expect(await revParse(fx.localDir, 'refs/coja/pull/1/base')).toBe(fx.baseOid)
    expect(await snapshot(fx)).toEqual(before)
    await expect(access(path.join(fx.localDir, '.git', 'FETCH_HEAD'))).rejects.toThrow()
  })

  it('surfaces git stderr for a missing remote ref', async () => {
    const err = (await fetch(fx.localDir, 'origin', [
      '+refs/pull/99/head:refs/coja/pull/99/head',
    ]).catch((e: unknown) => e)) as GitError
    expect(err).toBeInstanceOf(GitError)
    expect(err.stderr).toContain("couldn't find remote ref refs/pull/99/head")
  })

  it('refuses option-like arguments and empty refspec lists', async () => {
    await expect(fetch(fx.localDir, 'origin', [])).rejects.toThrow(/at least one refspec/)
    await expect(fetch(fx.localDir, '--upload-pack=x', ['main'])).rejects.toThrow(
      /invalid argument/,
    )
  })
})

describe('blobs and trees', () => {
  it('blobInfo reports blobs, trees and missing paths', async () => {
    expect(await blobInfo(fx.originDir, fx.headOid, 'src/app.ts')).toEqual({
      exists: true,
      type: 'blob',
      size: Buffer.byteLength(APP_TS_HEAD),
      oid: expect.stringMatching(/^[0-9a-f]{40}$/),
    })
    expect((await blobInfo(fx.originDir, fx.headOid, 'src')).type).toBe('tree')
    expect(await blobInfo(fx.originDir, fx.headOid, 'src/remove-me.ts')).toMatchObject({
      exists: false,
    })
    expect(await blobInfo(fx.originDir, fx.baseOid, 'src/remove-me.ts')).toMatchObject({
      exists: true,
    })
    expect(await blobInfo(fx.originDir, fx.headOid, 'app/[id]/page.tsx')).toMatchObject({
      exists: true,
    })
  })

  it('showFile returns text, flags binaries and truncates large files', async () => {
    const text = await showFile(fx.originDir, fx.headOid, 'src/app.ts')
    expect(text).toEqual({
      text: APP_TS_HEAD,
      binary: false,
      size: Buffer.byteLength(APP_TS_HEAD),
      truncated: false,
    })

    const bin = await showFile(fx.originDir, fx.headOid, 'assets/logo.bin')
    expect(bin).toEqual({ text: '', binary: true, size: 10, truncated: false })

    const cut = await showFile(fx.originDir, fx.headOid, 'src/app.ts', { maxBytes: 16 })
    expect(cut.truncated).toBe(true)
    expect(cut.text).toBe(APP_TS_HEAD.slice(0, 16))
    expect(cut.size).toBe(Buffer.byteLength(APP_TS_HEAD))

    await expect(showFile(fx.originDir, fx.headOid, 'nope.ts')).rejects.toBeInstanceOf(GitError)
    await expect(showFile(fx.originDir, fx.headOid, 'src')).rejects.toBeInstanceOf(GitError)
  })

  it('lsTree lists recursively with sizes, non-recursively with trees, and by path', async () => {
    const all = await lsTree(fx.originDir, fx.headOid)
    expect(all.map((e) => e.path).sort()).toEqual([
      'README.md',
      'app/[id]/page.tsx',
      'assets/logo.bin',
      'docs/notes.md',
      'src/app.ts',
      'src/feature.ts',
      'src/util/helpers.ts',
    ])
    const app = all.find((e) => e.path === 'src/app.ts')
    expect(app).toMatchObject({
      mode: '100644',
      type: 'blob',
      size: Buffer.byteLength(APP_TS_HEAD),
    })
    expect(app?.oid).toMatch(/^[0-9a-f]{40}$/)

    const top = await lsTree(fx.originDir, fx.headOid, { recursive: false })
    expect(top.find((e) => e.path === 'src')).toMatchObject({
      type: 'tree',
      mode: '040000',
      size: null,
    })

    const src = await lsTree(fx.originDir, fx.headOid, { path: 'src' })
    expect(src.map((e) => e.path)).toEqual(['src/app.ts', 'src/feature.ts', 'src/util/helpers.ts'])

    const glob = await lsTree(fx.originDir, fx.headOid, { path: 'app/[id]/page.tsx' })
    expect(glob.map((e) => e.path)).toEqual(['app/[id]/page.tsx'])
  })
})

describe('grep', () => {
  it('finds matches with paths stripped of the oid prefix', async () => {
    const { matches, truncated } = await grep(fx.originDir, fx.headOid, 'greeting')
    expect(truncated).toBe(false)
    expect(matches).toEqual([
      { path: 'src/app.ts', line: 2, text: "  const greeting = 'HELLO'" },
      { path: 'src/app.ts', line: 4, text: "  return greeting + ' ' + flag" },
    ])
  })

  it('returns no matches (exit 1) without throwing', async () => {
    expect(await grep(fx.originDir, fx.headOid, 'zzz-not-here')).toEqual({
      matches: [],
      truncated: false,
    })
  })

  it('handles a pattern that starts with a dash', async () => {
    const fixed = await grep(fx.originDir, fx.headOid, '-weird', { fixedStrings: true })
    expect(fixed.matches).toEqual([
      { path: 'src/app.ts', line: 3, text: "  const flag = '-weird'" },
    ])
    const regex = await grep(fx.originDir, fx.headOid, '-w[a-z]+rd')
    expect(regex.matches.map((m) => m.line)).toEqual([3])
  })

  it('supports ignoreCase, a pathspec filter and maxMatches truncation', async () => {
    expect((await grep(fx.originDir, fx.headOid, 'hello')).matches).toEqual([])
    expect(
      (await grep(fx.originDir, fx.headOid, 'hello', { ignoreCase: true })).matches,
    ).toHaveLength(1)

    const only = await grep(fx.originDir, fx.headOid, 'export', { pathspec: 'src/util/*.ts' })
    expect(new Set(only.matches.map((m) => m.path))).toEqual(new Set(['src/util/helpers.ts']))

    const capped = await grep(fx.originDir, fx.headOid, 'export', { maxMatches: 2 })
    expect(capped.matches).toHaveLength(2)
    expect(capped.truncated).toBe(true)
  })

  it('rejects an empty pattern and option-like pathspecs', async () => {
    await expect(grep(fx.originDir, fx.headOid, '')).rejects.toThrow(HttpError)
    await expect(grep(fx.originDir, fx.headOid, 'x', { pathspec: '--all' })).rejects.toThrow(
      HttpError,
    )
  })
})

describe('diff', () => {
  it('produces a standard unified patch with a/ b/ prefixes', async () => {
    const { patch, truncated } = await diff(fx.originDir, fx.baseOid, fx.headOid, {
      paths: ['src/app.ts'],
    })
    expect(truncated).toBe(false)
    expect(patch).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(patch).toContain('--- a/src/app.ts')
    expect(patch).toContain('+++ b/src/app.ts')
    expect(patch).toContain("-  const greeting = 'hello'")
    expect(patch).toContain("+  const greeting = 'HELLO'")
    expect(patch).toMatch(/^@@ -1,5 \+1,5 @@/m) // 3 lines of context around line 2
  })

  it('honours unified context size', async () => {
    const { patch } = await diff(fx.originDir, fx.baseOid, fx.headOid, {
      paths: ['src/app.ts'],
      unified: 0,
    })
    expect(patch).toMatch(/^@@ -2 \+2 @@/m)
  })

  it('detects renames when both paths are given', async () => {
    const { patch } = await diff(fx.originDir, fx.baseOid, fx.headOid, {
      paths: ['src/util/helpers.ts', 'src/legacy/helpers.ts'],
    })
    expect(patch).toContain('rename from src/legacy/helpers.ts')
    expect(patch).toContain('rename to src/util/helpers.ts')
    expect(patch).toMatch(/^similarity index \d+%$/m)
    expect(patch).toContain('+export const h12 = 1200')
  })

  it('marks binary files', async () => {
    const { patch } = await diff(fx.originDir, fx.baseOid, fx.headOid, {
      paths: ['assets/logo.bin'],
    })
    expect(patch).toMatch(/^Binary files \/dev\/null and b\/assets\/logo\.bin differ$/m)
  })

  it('withholds patches over maxBytes', async () => {
    expect(await diff(fx.originDir, fx.baseOid, fx.headOid, { maxBytes: 64 })).toEqual({
      patch: '',
      truncated: true,
    })
  })

  it('treats glob characters in paths literally', async () => {
    const { patch } = await diff(fx.originDir, fx.baseOid, fx.headOid, {
      paths: ['app/[id]/page.tsx'],
    })
    expect(patch).toContain('diff --git a/app/[id]/page.tsx b/app/[id]/page.tsx')
    expect(patch.match(/^diff --git /gm)).toHaveLength(1)
  })

  it('diffs the whole tree when no paths are given', async () => {
    const { patch } = await diff(fx.originDir, fx.baseOid, fx.headOid)
    expect(patch.match(/^diff --git /gm)).toHaveLength(6)
  })
})

describe('diffNameStatus', () => {
  it('reports adds, edits, deletes, renames (with previousPath) and binaries', async () => {
    const files = await diffNameStatus(fx.originDir, fx.baseOid, fx.headOid)
    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'app/[id]/page.tsx', status: 'M' },
        { path: 'assets/logo.bin', status: 'A' },
        { path: 'src/app.ts', status: 'M' },
        { path: 'src/feature.ts', status: 'A' },
        { path: 'src/remove-me.ts', status: 'D' },
        { path: 'src/util/helpers.ts', previousPath: 'src/legacy/helpers.ts', status: 'R' },
      ]),
    )
    expect(files).toHaveLength(6)
  })

  it('is empty for identical commits', async () => {
    expect(await diffNameStatus(fx.originDir, fx.headOid, fx.headOid)).toEqual([])
  })
})

describe('log', () => {
  it('lists the commits in base..head with parsed fields', async () => {
    const entries = await log(fx.originDir, { range: `${fx.baseOid}..refs/pull/1/head` })
    expect(entries).toEqual([
      {
        oid: fx.headOid,
        abbreviatedOid: expect.stringMatching(/^[0-9a-f]{7,}$/),
        authorName: 'Ada Lovelace',
        authorEmail: 'ada@example.com',
        authoredAt: FIXTURE_AUTHOR_DATE,
        subject: 'Add feature and tidy helpers',
        body: 'Renames the legacy helpers and drops remove-me.',
      },
    ])
    expect(fx.headOid.startsWith(entries[0]?.abbreviatedOid ?? '!')).toBe(true)
  })

  it('filters by path and honours maxCount', async () => {
    const readme = await log(fx.originDir, { range: 'main', path: 'README.md' })
    expect(readme.map((e) => e.subject)).toEqual(['Main moves on', 'Initial import'])
    const one = await log(fx.originDir, { range: 'main', maxCount: 1 })
    expect(one.map((e) => e.oid)).toEqual([fx.mainOid])
    const none = await log(fx.originDir, { range: 'main', path: 'src/feature.ts' })
    expect(none).toEqual([])
  })

  it('rejects option-like ranges', async () => {
    await expect(log(fx.originDir, { range: '--all' })).rejects.toThrow(HttpError)
  })
})

describe('blame', () => {
  it('attributes every line, with the edited line on the PR commit', async () => {
    const lines = await blame(fx.originDir, fx.headOid, 'src/app.ts')
    expect(lines).toHaveLength(13)
    expect(lines.map((l) => l.line)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    expect(lines[1]).toEqual({
      line: 2,
      oid: fx.headOid,
      abbreviatedOid: fx.headOid.slice(0, 7),
      author: 'Ada Lovelace',
      authorTime: FIXTURE_AUTHOR_DATE,
      summary: 'Add feature and tidy helpers',
      content: "  const greeting = 'HELLO'",
    })
    expect(lines[0]).toMatchObject({ oid: fx.baseOid, summary: 'Initial import' })
  })

  it('limits to a line range', async () => {
    const lines = await blame(fx.originDir, fx.headOid, 'src/app.ts', { startLine: 3, endLine: 4 })
    expect(lines.map((l) => [l.line, l.content])).toEqual([
      [3, "  const flag = '-weird'"],
      [4, "  return greeting + ' ' + flag"],
    ])
    const tail = await blame(fx.originDir, fx.headOid, 'src/app.ts', { startLine: 12 })
    expect(tail.map((l) => l.line)).toEqual([12, 13])
    await expect(
      blame(fx.originDir, fx.headOid, 'src/app.ts', { startLine: 4, endLine: 2 }),
    ).rejects.toThrow(HttpError)
  })
})

describe('cloneBare', () => {
  it('creates a bare clone configured to authenticate through gh', async () => {
    const dir = path.join(scratch, 'clone.git')
    await cloneBare(fx.originDir, dir)
    expect(await isBareRepo(dir)).toBe(true)
    expect(await revParse(dir, 'main')).toBe(fx.mainOid)
    // Repo-local values: an empty one resets helpers inherited from system/global config, then gh.
    const helpers = await runGit(dir, ['config', '--local', '--get-all', 'credential.helper'])
    expect(helpers.stdout.toString('utf8')).toBe(`\n${GH_CREDENTIAL_HELPER}\n`)
    // PR refs are fetched the same way as in a local project.
    await fetch(dir, 'origin', ['+refs/pull/1/head:refs/coja/pull/1/head'])
    expect(await revParse(dir, 'refs/coja/pull/1/head')).toBe(fx.headOid)
  })

  it('fails with a GitError for an unreachable source', async () => {
    const dir = path.join(scratch, 'missing.git')
    await expect(cloneBare(path.join(fx.root, 'nope.git'), dir)).rejects.toBeInstanceOf(GitError)
  })
})

/** Everything about the user's checkout that a fetch must leave alone. */
async function snapshot(f: Fixture): Promise<Record<string, string>> {
  return {
    status: await f.git(f.localDir, ['status', '--porcelain', '--branch']),
    head: await f.git(f.localDir, ['symbolic-ref', 'HEAD']),
    refs: await f.git(f.localDir, [
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
  }
}
