import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { APP_TS_HEAD, createFixture, type Fixture } from '../git/test-fixture.js'
import { HttpError } from '../routes/http.js'
import { getBlob, getChangedFiles, getFileDiff } from './objects.js'

const MiB = 1024 * 1024

let fx: Fixture

beforeAll(async () => {
  fx = await createFixture()
})

afterAll(() => fx.cleanup())

describe('getChangedFiles', () => {
  it('lists the PR files relative to the merge base', async () => {
    const files = await getChangedFiles(fx.originDir, fx.baseOid, fx.headOid)
    expect(files.map((f) => `${f.status} ${f.path}`).sort()).toEqual([
      'A assets/logo.bin',
      'A src/feature.ts',
      'D src/remove-me.ts',
      'M app/[id]/page.tsx',
      'M src/app.ts',
      'R src/util/helpers.ts',
    ])
    expect(files.find((f) => f.status === 'R')?.previousPath).toBe('src/legacy/helpers.ts')
  })
})

describe('getFileDiff', () => {
  it('returns a one-file patch', async () => {
    const res = await getFileDiff(fx.originDir, fx.baseOid, fx.headOid, 'src/app.ts')
    expect(res).toMatchObject({ path: 'src/app.ts', binary: false, tooLarge: false })
    expect(res.previousPath).toBeUndefined()
    expect(res.patch).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(res.patch.match(/^diff --git /gm)).toHaveLength(1)
  })

  it('pairs a rename when previousPath is given', async () => {
    const res = await getFileDiff(
      fx.originDir,
      fx.baseOid,
      fx.headOid,
      'src/util/helpers.ts',
      'src/legacy/helpers.ts',
    )
    expect(res.previousPath).toBe('src/legacy/helpers.ts')
    expect(res.patch).toContain('rename from src/legacy/helpers.ts')
    expect(res.patch).toContain('rename to src/util/helpers.ts')
  })

  it('flags binary files with an empty patch', async () => {
    const res = await getFileDiff(fx.originDir, fx.baseOid, fx.headOid, 'assets/logo.bin')
    expect(res).toEqual({ path: 'assets/logo.bin', patch: '', binary: true, tooLarge: false })
  })

  it('is empty for an unchanged file', async () => {
    const res = await getFileDiff(fx.originDir, fx.baseOid, fx.headOid, 'docs/notes.md')
    expect(res.patch).toBe('')
    expect(res.binary).toBe(false)
  })

  it('validates paths', async () => {
    await expect(getFileDiff(fx.originDir, fx.baseOid, fx.headOid, '../x')).rejects.toThrow(
      HttpError,
    )
    await expect(getFileDiff(fx.originDir, fx.baseOid, fx.headOid, 'a', '-b')).rejects.toThrow(
      HttpError,
    )
  })
})

describe('getBlob', () => {
  it('returns the whole file with its line count', async () => {
    const blob = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts')
    expect(blob).toEqual({
      ref: 'head',
      oid: fx.headOid,
      path: 'src/app.ts',
      text: APP_TS_HEAD,
      lineCount: 13,
      size: Buffer.byteLength(APP_TS_HEAD),
      truncated: false,
    })
  })

  it('returns a clamped 1-based inclusive range', async () => {
    const blob = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 2, 3)
    expect(blob).toMatchObject({
      startLine: 2,
      endLine: 3,
      lineCount: 13,
      text: "  const greeting = 'HELLO'\n  const flag = '-weird'",
      truncated: false,
    })
    const clamped = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 12, 99)
    expect(clamped).toMatchObject({ startLine: 12, endLine: 13, text: '\nexport { helper }' })
    const fromStart = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', undefined, 1)
    expect(fromStart).toMatchObject({
      startLine: 1,
      endLine: 1,
      text: 'export function app(): string {',
    })
    const inverted = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 5, 2)
    expect(inverted).toMatchObject({ startLine: 5, endLine: 5 })
  })

  it('reads the base side too', async () => {
    const blob = await getBlob(fx.originDir, 'base', fx.baseOid, 'src/remove-me.ts')
    expect(blob).toMatchObject({
      ref: 'base',
      oid: fx.baseOid,
      text: 'export const gone = true\n',
      lineCount: 1,
    })
  })

  it('404s for a missing path and 400s for directories and binaries', async () => {
    const missing = await getBlob(fx.originDir, 'head', fx.headOid, 'src/remove-me.ts').catch(
      (e: unknown) => e,
    )
    expect(missing).toBeInstanceOf(HttpError)
    expect((missing as HttpError).status).toBe(404)
    expect((missing as HttpError).code).toBe('not_found')

    const dir = await getBlob(fx.originDir, 'head', fx.headOid, 'src').catch((e: unknown) => e)
    expect((dir as HttpError).status).toBe(400)

    const bin = await getBlob(fx.originDir, 'head', fx.headOid, 'assets/logo.bin').catch(
      (e: unknown) => e,
    )
    expect((bin as HttpError).status).toBe(400)
    expect((bin as HttpError).message).toContain('binary')
  })
})

describe('getBlob on files over the size cap', () => {
  const FIRST_LINE = 'export function app(): string {\n' // 32 bytes; line 2 starts right after
  const size = Buffer.byteLength(APP_TS_HEAD)

  it('keeps whole lines only, counts every line of the real file and says it truncated', async () => {
    // 40 bytes: the whole first line plus the beginning of the second, which is dropped.
    const cut = await getBlob(
      fx.originDir,
      'head',
      fx.headOid,
      'src/app.ts',
      undefined,
      undefined,
      {
        maxBytes: 40,
      },
    )
    expect(cut).toEqual({
      ref: 'head',
      oid: fx.headOid,
      path: 'src/app.ts',
      text: FIRST_LINE,
      lineCount: 13,
      size,
      truncated: true,
    })
    // A cap that ends exactly on a newline keeps that line.
    const exact = await getBlob(
      fx.originDir,
      'head',
      fx.headOid,
      'src/app.ts',
      undefined,
      undefined,
      {
        maxBytes: 32,
      },
    )
    expect(exact).toMatchObject({ text: FIRST_LINE, lineCount: 13, truncated: true })
    // A cap too small for even one line yields no text, but still the truth about the file.
    const nothing = await getBlob(
      fx.originDir,
      'head',
      fx.headOid,
      'src/app.ts',
      undefined,
      undefined,
      {
        maxBytes: 8,
      },
    )
    expect(nothing).toMatchObject({ text: '', lineCount: 13, size, truncated: true })
  })

  it('reports a range as truncated only when it reaches past the lines read', async () => {
    const opts = { maxBytes: 40 }
    const within = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 1, 1, opts)
    expect(within).toMatchObject({
      startLine: 1,
      endLine: 1,
      text: FIRST_LINE.trimEnd(),
      lineCount: 13,
      truncated: false,
    })
    const past = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 1, 3, opts)
    expect(past).toMatchObject({
      startLine: 1,
      endLine: 3,
      text: FIRST_LINE.trimEnd(),
      truncated: true,
    })
    const beyond = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 5, 6, opts)
    expect(beyond).toMatchObject({ startLine: 5, endLine: 6, text: '', truncated: true })
  })

  it('handles a real file over 5 MiB with the default cap', async () => {
    // A 6,000,000-byte blob of 60,000 hundred-byte lines, committed with plumbing only.
    const line = `${'x'.repeat(99)}\n`
    const lineCount = 60_000
    const content = line.repeat(lineCount)
    const blobOid = (
      await runGit(fx.originDir, ['hash-object', '-w', '--stdin'], { input: content })
    ).stdout
      .toString('utf8')
      .trim()
    const treeOid = (
      await runGit(fx.originDir, ['mktree'], { input: `100644 blob ${blobOid}\tbig.txt\n` })
    ).stdout
      .toString('utf8')
      .trim()
    const commitOid = await fx.git(fx.originDir, ['commit-tree', treeOid, '-m', 'big file'])

    const blob = await getBlob(fx.originDir, 'head', commitOid, 'big.txt')
    const completeLines = Math.floor((5 * MiB) / line.length)
    expect(blob).toMatchObject({ size: content.length, lineCount, truncated: true })
    expect(blob.text).toBe(line.repeat(completeLines))
    expect(blob.text.length).toBeLessThanOrEqual(5 * MiB)

    const tail = await getBlob(fx.originDir, 'head', commitOid, 'big.txt', lineCount - 9, lineCount)
    expect(tail).toMatchObject({
      startLine: lineCount - 9,
      endLine: lineCount,
      text: '',
      lineCount,
      truncated: true,
    })
    const head = await getBlob(fx.originDir, 'head', commitOid, 'big.txt', 1, 2)
    expect(head).toMatchObject({ text: `${line}${line}`.trimEnd(), truncated: false })
  })
})
