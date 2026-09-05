import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolExecutionOptions } from 'ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { diffNameStatus } from '../git/plumbing.js'
import { createFixture, FIXTURE_AUTHOR_DATE, type Fixture } from '../git/test-fixture.js'
import {
  BLAME_MAX_LINES,
  createReviewTools,
  describeTools,
  patchStats,
  READ_DEFAULT_LINES,
  READ_MAX_LINES,
  REVIEW_TOOL_NAMES,
  type ToolContext,
} from './tools.js'

/** Exercise a tool the way the SDK does: `execute(input, options)`. */
const opts = { toolCallId: 'call-1', messages: [] } as unknown as ToolExecutionOptions<never>

type Executable<I, O> = {
  execute: (input: I, options: ToolExecutionOptions<never>) => AsyncIterable<O> | PromiseLike<O> | O
}

async function run<I, O>(t: Executable<I, O>, input: I): Promise<O> {
  return (await t.execute(input, opts)) as O
}

const BIG_LINES = 1000
const PR_COMMIT_SUBJECT = 'Add feature and tidy helpers'

let fx: Fixture
let ctx: ToolContext
let tools: ReturnType<typeof createReviewTools>
/** Tools for a second PR head that adds a 1000-line file, for the per-call caps. */
let bigCtx: ToolContext
let big: ReturnType<typeof createReviewTools>
/** The 1000-line file's content, to predict what a byte cap leaves readable. */
let bigBody: string

beforeAll(async () => {
  fx = await createFixture()
  // The bare "GitHub" repository: proves the tools need no working tree at all.
  ctx = {
    repo: fx.originDir,
    headOid: fx.headOid,
    baseOid: fx.baseOid,
    files: await diffNameStatus(fx.originDir, fx.baseOid, fx.headOid),
  }
  tools = createReviewTools(ctx)

  // Author one more PR commit with a long file, the way the fixture authors its own commits.
  await fx.git(fx.workDir, ['checkout', '--quiet', 'feature'])
  const body = Array.from({ length: BIG_LINES }, (_, i) => `export const v${i + 1} = ${i + 1}`)
  bigBody = `${body.join('\n')}\n`
  await writeFile(path.join(fx.workDir, 'src/big.ts'), bigBody)
  await fx.git(fx.workDir, ['add', '-A'])
  await fx.git(fx.workDir, ['commit', '--quiet', '--no-gpg-sign', '-m', 'Add a big file'])
  const bigOid = await fx.git(fx.workDir, ['rev-parse', 'HEAD'])
  await fx.git(fx.workDir, ['push', '--quiet', 'origin', 'feature:refs/pull/2/head'])
  await fx.git(fx.workDir, ['checkout', '--quiet', 'main'])
  bigCtx = {
    repo: fx.originDir,
    headOid: bigOid,
    baseOid: fx.baseOid,
    files: await diffNameStatus(fx.originDir, fx.baseOid, bigOid),
  }
  big = createReviewTools(bigCtx)
})

afterAll(() => fx.cleanup())

describe('tool surface', () => {
  it('has exactly the six read-only tools, in the documented order', () => {
    expect(REVIEW_TOOL_NAMES).toEqual([
      'read_file',
      'list_files',
      'grep',
      'get_diff',
      'git_log',
      'git_blame',
    ])
    expect(Object.keys(tools)).toEqual([...REVIEW_TOOL_NAMES])
    const described = describeTools()
    expect(described.map((t) => t.name)).toEqual([...REVIEW_TOOL_NAMES])
    for (const { name, description } of described) {
      expect(description.length, name).toBeGreaterThan(40)
      expect(tools[name as keyof typeof tools].description).toBe(description)
    }
  })

  it('accepts only base|head as ref — the model can never name another revision', () => {
    const schema = tools.read_file.inputSchema as unknown as z.ZodType
    expect(schema.safeParse({ ref: 'head', path: 'src/app.ts' }).success).toBe(true)
    expect(schema.safeParse({ ref: 'base', path: 'src/app.ts', startLine: 1 }).success).toBe(true)
    for (const ref of ['main', 'HEAD', fx.headOid, 'refs/heads/main', 'origin/main', '', 'Head']) {
      expect(schema.safeParse({ ref, path: 'src/app.ts' }).success, `ref=${ref}`).toBe(false)
    }
    for (const name of ['list_files', 'grep', 'git_blame'] as const) {
      const s = tools[name].inputSchema as unknown as z.ZodType
      expect(s.safeParse({ ref: 'main', path: 'x', pattern: 'x' }).success, name).toBe(false)
      expect(s.safeParse({ ref: 'head', path: 'x', pattern: 'x' }).success, name).toBe(true)
    }
  })
})

describe('read_file', () => {
  it('reads head and base with numbered lines', async () => {
    const head = await run(tools.read_file, { ref: 'head', path: 'src/app.ts' })
    expect(head).toMatchObject({
      path: 'src/app.ts',
      ref: 'head',
      oid: fx.headOid,
      startLine: 1,
      endLine: 13,
      lineCount: 13,
      truncated: false,
    })
    expect(head).not.toHaveProperty('note')
    expect(head.content.split('\n')).toHaveLength(13)
    expect(head.content).toContain("   2│   const greeting = 'HELLO'")
    expect(head.content).toContain('  13│ export { helper }')

    const base = await run(tools.read_file, { ref: 'base', path: 'src/app.ts' })
    expect(base.oid).toBe(fx.baseOid)
    expect(base.content).toContain("   2│   const greeting = 'hello'")
  })

  it('honours line windows and clamps them to the file', async () => {
    const w = await run(tools.read_file, {
      ref: 'head',
      path: 'src/app.ts',
      startLine: 2,
      endLine: 3,
    })
    expect(w).toMatchObject({ startLine: 2, endLine: 3, lineCount: 13, truncated: false })
    expect(w.content.split('\n')).toEqual([
      "   2│   const greeting = 'HELLO'",
      "   3│   const flag = '-weird'",
    ])
    expect(w.note).toContain('startLine=4')

    const tail = await run(tools.read_file, {
      ref: 'head',
      path: 'src/app.ts',
      startLine: 12,
      endLine: 99,
    })
    expect(tail).toMatchObject({ startLine: 12, endLine: 13, truncated: false })
    expect(tail).not.toHaveProperty('note')

    await expect(
      run(tools.read_file, { ref: 'head', path: 'src/app.ts', startLine: 14 }),
    ).rejects.toThrow(/past the end/)
    await expect(
      run(tools.read_file, { ref: 'head', path: 'src/app.ts', startLine: 5, endLine: 4 }),
    ).rejects.toThrow(/endLine/)
  })

  it(`returns ${READ_DEFAULT_LINES} lines by default and never more than ${READ_MAX_LINES}`, async () => {
    const dflt = await run(big.read_file, { ref: 'head', path: 'src/big.ts' })
    expect(dflt).toMatchObject({
      startLine: 1,
      endLine: READ_DEFAULT_LINES,
      lineCount: BIG_LINES,
      truncated: false,
    })
    expect(dflt.content.split('\n')).toHaveLength(READ_DEFAULT_LINES)
    expect(dflt.note).toContain(`startLine=${READ_DEFAULT_LINES + 1}`)

    const capped = await run(big.read_file, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: 1,
      endLine: BIG_LINES,
    })
    expect(capped).toMatchObject({ startLine: 1, endLine: READ_MAX_LINES, truncated: true })
    const lines = capped.content.split('\n')
    expect(lines).toHaveLength(READ_MAX_LINES)
    expect(lines[0]).toBe('   1│ export const v1 = 1')
    expect(lines[lines.length - 1]).toBe(' 400│ export const v400 = 400')
    expect(capped.note).toContain(`startLine=${READ_MAX_LINES + 1}`)

    const next = await run(big.read_file, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: 401,
      endLine: BIG_LINES,
    })
    expect(next).toMatchObject({ startLine: 401, endLine: 800, truncated: true })
    const last = await run(big.read_file, { ref: 'head', path: 'src/big.ts', startLine: 801 })
    expect(last).toMatchObject({ startLine: 801, endLine: BIG_LINES, truncated: false })
    expect(last).not.toHaveProperty('note')
    expect(last.content.split('\n')[199]).toBe('1000│ export const v1000 = 1000')
  })

  it('explains missing paths, directories and binaries', async () => {
    await expect(run(tools.read_file, { ref: 'head', path: 'src/remove-me.ts' })).rejects.toThrow(
      /does not exist at head .*deletes it, read it with ref "base"/,
    )
    await expect(run(tools.read_file, { ref: 'base', path: 'src/feature.ts' })).rejects.toThrow(
      /does not exist at base .*adds it, read it with ref "head"/,
    )
    await expect(
      run(tools.read_file, { ref: 'head', path: 'src/legacy/helpers.ts' }),
    ).rejects.toThrow(/renames it to src\/util\/helpers\.ts/)
    await expect(
      run(tools.read_file, { ref: 'base', path: 'src/util/helpers.ts' }),
    ).rejects.toThrow(/at base it is src\/legacy\/helpers\.ts/)
    await expect(run(tools.read_file, { ref: 'head', path: 'nope.ts' })).rejects.toThrow(
      /nope\.ts does not exist at head/,
    )
    await expect(run(tools.read_file, { ref: 'head', path: 'src' })).rejects.toThrow(/directory/)
    await expect(run(tools.read_file, { ref: 'head', path: 'assets/logo.bin' })).rejects.toThrow(
      /^binary file/,
    )
    // Path validation is the plumbing layer's; its message comes through unchanged.
    await expect(run(tools.read_file, { ref: 'head', path: '../etc/passwd' })).rejects.toThrow(
      /must not contain "\.\."/,
    )
    await expect(run(tools.read_file, { ref: 'head', path: '-rf' })).rejects.toThrow(/"-"/)
  })
})

describe('read_file and git_blame on a blob over the byte cap', () => {
  const CAP = 1024

  /** Lines that end within the first `bytes` bytes of `text` — what a capped read can show whole. */
  const completeLines = (text: string, bytes: number): number =>
    Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8').split('\n').length - 1

  it('counts every line, shows what was read, and never calls a real line "past the end"', async () => {
    const capped = createReviewTools(bigCtx, { maxBlobBytes: CAP })
    const size = Buffer.byteLength(bigBody)
    const readable = completeLines(bigBody, CAP)
    expect(readable).toBeGreaterThan(10)
    expect(readable).toBeLessThan(READ_DEFAULT_LINES)

    // The default window runs past the cap: the complete lines that fit, and honest bookkeeping.
    const head = await run(capped.read_file, { ref: 'head', path: 'src/big.ts' })
    expect(head).toMatchObject({
      startLine: 1,
      endLine: READ_DEFAULT_LINES,
      lineCount: BIG_LINES,
      truncated: true,
    })
    const lines = head.content.split('\n')
    expect(lines).toHaveLength(readable)
    expect(lines[readable - 1]).toBe(
      `${String(readable).padStart(4)}│ export const v${readable} = ${readable}`,
    )
    expect(head.note).toContain(
      `The file is ${size} bytes; only its first ${CAP} bytes (${readable} complete lines of ${BIG_LINES}) were read.`,
    )
    expect(head.note).toContain(
      `Lines ${readable + 1}-${READ_DEFAULT_LINES} lie beyond what was read and are not shown`,
    )

    // A valid window entirely past the cap is empty but not an error (it used to be "past the end").
    const tail = await run(capped.read_file, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: 900,
      endLine: 905,
    })
    expect(tail).toMatchObject({
      startLine: 900,
      endLine: 905,
      lineCount: BIG_LINES,
      truncated: true,
      content: '',
    })
    expect(tail.note).toContain('Lines 900-905 lie beyond what was read')
    // The true end of the file is still the end.
    await expect(
      run(capped.read_file, { ref: 'head', path: 'src/big.ts', startLine: BIG_LINES + 1 }),
    ).rejects.toThrow(/past the end of the file, which has 1000 lines/)

    // git_blame attributes lines past the cap (git reads the blob itself) and carries the same note.
    const blamed = await run(capped.git_blame, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: BIG_LINES - 2,
      endLine: BIG_LINES,
    })
    expect(blamed).toMatchObject({
      startLine: BIG_LINES - 2,
      endLine: BIG_LINES,
      lineCount: BIG_LINES,
      truncated: false,
    })
    expect(blamed.lines.map((l) => l.content)).toEqual([
      'export const v998 = 998',
      'export const v999 = 999',
      'export const v1000 = 1000',
    ])
    expect(blamed.note).toBe(
      `The file is ${size} bytes; only its first ${CAP} bytes (${readable} complete lines of ${BIG_LINES}) were read.`,
    )

    // Without the cap the same file reads whole and says nothing about truncation.
    const whole = await run(big.read_file, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: 900,
      endLine: 905,
    })
    expect(whole).toMatchObject({ lineCount: BIG_LINES, truncated: false })
    expect(whole.content.split('\n')).toHaveLength(6)
    expect(whole.note).not.toContain('were read')
  })
})

describe('list_files', () => {
  it('lists blobs recursively at head and base, with sizes', async () => {
    const head = await run(tools.list_files, { ref: 'head' })
    const paths = head.entries.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'src/feature.ts',
        'src/util/helpers.ts',
        'app/[id]/page.tsx',
        'assets/logo.bin',
      ]),
    )
    expect(paths).not.toContain('src/remove-me.ts')
    expect(paths).not.toContain('src/legacy/helpers.ts')
    expect(head.truncated).toBe(false)
    expect(head.entries.find((e) => e.path === 'src/feature.ts')?.size).toBe(
      'export const feature = () => 42\n'.length,
    )

    const base = await run(tools.list_files, { ref: 'base' })
    const basePaths = base.entries.map((e) => e.path)
    expect(basePaths).toContain('src/remove-me.ts')
    expect(basePaths).toContain('src/legacy/helpers.ts')
    expect(basePaths).not.toContain('src/feature.ts')
  })

  it('filters by directory, with or without a trailing slash', async () => {
    for (const p of ['src/util', 'src/util/']) {
      const res = await run(tools.list_files, { ref: 'head', path: p })
      expect(
        res.entries.map((e) => e.path),
        p,
      ).toEqual(['src/util/helpers.ts'])
    }
    const src = await run(tools.list_files, { ref: 'head', path: 'src' })
    expect(src.entries.map((e) => e.path).sort()).toEqual([
      'src/app.ts',
      'src/feature.ts',
      'src/util/helpers.ts',
    ])
    const none = await run(tools.list_files, { ref: 'head', path: 'does-not-exist' })
    expect(none.entries).toEqual([])
    expect(none.note).toContain('Nothing under does-not-exist')
  })
})

describe('grep', () => {
  it('finds matches at head and none at base, honouring pathspec and ignoreCase', async () => {
    expect(await run(tools.grep, { ref: 'head', pattern: 'HELLO' })).toEqual({
      matches: [{ path: 'src/app.ts', line: 2, text: "  const greeting = 'HELLO'" }],
      truncated: false,
    })
    expect(await run(tools.grep, { ref: 'base', pattern: 'HELLO' })).toEqual({
      matches: [],
      truncated: false,
    })
    const ci = await run(tools.grep, { ref: 'head', pattern: 'hello', ignoreCase: true })
    expect(ci.matches).toHaveLength(1)
    expect(
      (await run(tools.grep, { ref: 'head', pattern: 'HELLO', pathspec: 'docs/*' })).matches,
    ).toEqual([])
    const glob = await run(tools.grep, {
      ref: 'head',
      pattern: 'export const h1[0-9]',
      pathspec: 'src/util/',
    })
    expect(glob.matches.map((m) => `${m.path}:${m.line}`)).toEqual([
      'src/util/helpers.ts:10',
      'src/util/helpers.ts:11',
      'src/util/helpers.ts:12',
    ])
    // A broken regular expression is git's error, passed through to the model.
    await expect(run(tools.grep, { ref: 'head', pattern: '[' })).rejects.toThrow()
  })
})

describe('get_diff', () => {
  it('returns one file patch, pairing renames by either path', async () => {
    const app = await run(tools.get_diff, { file: 'src/app.ts' })
    if (!('file' in app)) throw new Error('expected a single-file patch')
    expect(app).toMatchObject({ file: 'src/app.ts', status: 'M', binary: false, truncated: false })
    expect(app).not.toHaveProperty('previousPath')
    expect(app.patch).toContain("-  const greeting = 'hello'")
    expect(app.patch).toContain("+  const greeting = 'HELLO'")

    const renamed = await run(tools.get_diff, { file: 'src/util/helpers.ts' })
    if (!('file' in renamed)) throw new Error('expected a single-file patch')
    expect(renamed).toMatchObject({
      file: 'src/util/helpers.ts',
      previousPath: 'src/legacy/helpers.ts',
      status: 'R',
    })
    expect(renamed.patch).toContain('rename from src/legacy/helpers.ts')
    expect(renamed.patch).toContain('rename to src/util/helpers.ts')
    expect(renamed.patch).toContain('+export const h12 = 1200')
    const byOldPath = await run(tools.get_diff, { file: 'src/legacy/helpers.ts' })
    if (!('file' in byOldPath)) throw new Error('expected a single-file patch')
    expect(byOldPath.file).toBe('src/util/helpers.ts')

    const bin = await run(tools.get_diff, { file: 'assets/logo.bin' })
    if (!('file' in bin)) throw new Error('expected a single-file patch')
    expect(bin.binary).toBe(true)
    expect(bin.note).toMatch(/binary/i)

    // README.md moved on main after the branch point: not part of this PR.
    await expect(run(tools.get_diff, { file: 'README.md' })).rejects.toThrow(
      /not changed in this pull request/,
    )
  })

  it('describes the whole PR with per-file stats and includes the patch when small', async () => {
    const all = await run(tools.get_diff, {})
    if (!('files' in all)) throw new Error('expected the whole-PR overview')
    expect(all.fileCount).toBe(6)
    const byPath = new Map(all.files.map((f) => [f.path, f]))
    expect(byPath.get('src/app.ts')).toEqual({
      path: 'src/app.ts',
      status: 'M',
      additions: 1,
      deletions: 1,
    })
    expect(byPath.get('src/feature.ts')).toEqual({
      path: 'src/feature.ts',
      status: 'A',
      additions: 1,
      deletions: 0,
    })
    expect(byPath.get('src/remove-me.ts')).toEqual({
      path: 'src/remove-me.ts',
      status: 'D',
      additions: 0,
      deletions: 1,
    })
    expect(byPath.get('src/util/helpers.ts')).toEqual({
      path: 'src/util/helpers.ts',
      previousPath: 'src/legacy/helpers.ts',
      status: 'R',
      additions: 1,
      deletions: 1,
    })
    expect(byPath.get('assets/logo.bin')).toEqual({
      path: 'assets/logo.bin',
      status: 'A',
      additions: 0,
      deletions: 0,
      binary: true,
    })
    if (!('patch' in all)) throw new Error('expected the small patch to be included')
    expect(all.patch).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(all.patch).toContain('diff --git a/app/[id]/page.tsx b/app/[id]/page.tsx')
    expect(all).not.toHaveProperty('note')
  })
})

describe('patchStats', () => {
  it('counts added and removed lines per file, treating header-like body lines correctly', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '--- not a header',
      '+new',
      '+++ also not a header',
      'diff --git a/old.txt b/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to new.txt',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/with space.png b/with space.png',
      'new file mode 100644',
      'Binary files /dev/null and b/with space.png differ',
      '',
    ].join('\n')
    expect(Object.fromEntries(patchStats(patch))).toEqual({
      'a.txt': { additions: 2, deletions: 2, binary: false },
      'new.txt': { additions: 0, deletions: 0, binary: false },
      'gone.txt': { additions: 0, deletions: 1, binary: false },
      'with space.png': { additions: 0, deletions: 0, binary: true },
    })
  })
})

describe('git_log', () => {
  it("lists the PR's commits only, newest first, optionally by path", async () => {
    const all = await run(tools.git_log, {})
    expect(all.commits.map((c) => c.subject)).toEqual([PR_COMMIT_SUBJECT])
    expect(all.commits[0]).toMatchObject({
      oid: fx.headOid,
      abbreviatedOid: fx.headOid.slice(0, 7),
      author: 'Ada Lovelace',
      authoredAt: FIXTURE_AUTHOR_DATE,
      body: 'Renames the legacy helpers and drops remove-me.',
    })
    expect(all.commits[0]).not.toHaveProperty('authorEmail')
    expect(all.truncated).toBe(false)
    expect(all.range).toContain(`${fx.baseOid.slice(0, 7)}..${fx.headOid.slice(0, 7)}`)

    expect((await run(tools.git_log, { path: 'src/feature.ts' })).commits).toHaveLength(1)
    // README.md changed on main after the branch point: not in base..head.
    expect((await run(tools.git_log, { path: 'README.md' })).commits).toEqual([])

    const two = await run(big.git_log, {})
    expect(two.commits.map((c) => c.subject)).toEqual(['Add a big file', PR_COMMIT_SUBJECT])
    const one = await run(big.git_log, { maxCount: 1 })
    expect(one.commits.map((c) => c.subject)).toEqual(['Add a big file'])
    expect(one.truncated).toBe(true)
    expect(one.note).toContain('More than 1 commits')
  })
})

describe('git_blame', () => {
  it('attributes lines to the PR commit or the base commit', async () => {
    const res = await run(tools.git_blame, {
      ref: 'head',
      path: 'src/app.ts',
      startLine: 1,
      endLine: 3,
    })
    expect(res).toMatchObject({
      ref: 'head',
      path: 'src/app.ts',
      oid: fx.headOid,
      startLine: 1,
      endLine: 3,
      lineCount: 13,
      truncated: false,
    })
    expect(res.note).toContain('startLine=4')
    expect(res.lines.map((l) => l.line)).toEqual([1, 2, 3])
    const [line1, line2] = res.lines
    expect(line2?.content).toBe("  const greeting = 'HELLO'")
    expect(res.commits[line2?.commit ?? '']).toEqual({
      oid: fx.headOid,
      author: 'Ada Lovelace',
      authoredAt: FIXTURE_AUTHOR_DATE,
      summary: PR_COMMIT_SUBJECT,
    })
    expect(res.commits[line1?.commit ?? '']).toMatchObject({
      oid: fx.baseOid,
      summary: 'Initial import',
    })

    const base = await run(tools.git_blame, {
      ref: 'base',
      path: 'src/app.ts',
      startLine: 2,
      endLine: 2,
    })
    expect(base.lines).toHaveLength(1)
    expect(base.commits[base.lines[0]?.commit ?? '']?.oid).toBe(fx.baseOid)
  })

  it(`caps a call at ${BLAME_MAX_LINES} lines and rejects bad ranges`, async () => {
    const capped = await run(big.git_blame, {
      ref: 'head',
      path: 'src/big.ts',
      startLine: 1,
      endLine: BIG_LINES,
    })
    expect(capped).toMatchObject({
      startLine: 1,
      endLine: BLAME_MAX_LINES,
      lineCount: BIG_LINES,
      truncated: true,
    })
    expect(capped.lines).toHaveLength(BLAME_MAX_LINES)
    expect(capped.note).toContain(`startLine=${BLAME_MAX_LINES + 1}`)
    expect(Object.values(capped.commits).map((c) => c.summary)).toEqual(['Add a big file'])

    const dflt = await run(big.git_blame, { ref: 'head', path: 'src/big.ts' })
    expect(dflt).toMatchObject({ startLine: 1, endLine: BLAME_MAX_LINES, truncated: false })

    await expect(run(tools.git_blame, { ref: 'head', path: 'src/remove-me.ts' })).rejects.toThrow(
      /does not exist/,
    )
    await expect(
      run(tools.git_blame, { ref: 'head', path: 'src/app.ts', startLine: 50 }),
    ).rejects.toThrow(/past the end/)
    await expect(run(tools.git_blame, { ref: 'head', path: 'assets/logo.bin' })).rejects.toThrow(
      /binary file/,
    )
  })
})
