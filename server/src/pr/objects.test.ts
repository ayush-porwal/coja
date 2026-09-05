import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_TS_HEAD, createFixture, type Fixture } from '../git/test-fixture.js'
import { HttpError } from '../routes/http.js'
import { getBlob, getChangedFiles, getFileDiff } from './objects.js'

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
    })
  })

  it('returns a clamped 1-based inclusive range', async () => {
    const blob = await getBlob(fx.originDir, 'head', fx.headOid, 'src/app.ts', 2, 3)
    expect(blob).toMatchObject({
      startLine: 2,
      endLine: 3,
      lineCount: 13,
      text: "  const greeting = 'HELLO'\n  const flag = '-weird'",
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
