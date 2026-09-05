import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../routes/http.js'
import { assertPathspec, assertRevision, GitError, runGit, runGitStreaming } from './run.js'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'coja-run-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('assertPathspec', () => {
  it('accepts ordinary repo-relative paths', () => {
    for (const p of [
      'README.md',
      'src/a.ts',
      'app/[id]/page.tsx',
      'sp ace.txt',
      'dir/',
      'a.b/c-d_e',
    ]) {
      expect(assertPathspec(p)).toBe(p)
    }
  })

  it.each([
    ['', 'path is required'],
    ['-rf', 'must not start with "-"'],
    ['--output=x', 'must not start with "-"'],
    ['../x', 'must not contain ".."'],
    ['a/../x', 'must not contain ".."'],
    ['./x', 'must not contain "." segments'],
    ['/etc/passwd', 'relative to the repository root'],
    ['C:\\x', 'relative to the repository root'],
    ['a\0b', 'control characters'],
    ['a\nb', 'control characters'],
    [':(glob)*.ts', 'must not start with ":"'],
    ['a//b', 'empty segments'],
  ])('rejects %j with a 400', (input, message) => {
    let caught: unknown
    try {
      assertPathspec(input)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HttpError)
    expect((caught as HttpError).status).toBe(400)
    expect((caught as HttpError).message).toContain(message)
  })

  it('rejects non-strings', () => {
    expect(() => assertPathspec(undefined)).toThrow(HttpError)
    expect(() => assertPathspec(42)).toThrow(HttpError)
  })
})

describe('assertRevision', () => {
  it('accepts oids, ref names and ranges', () => {
    for (const r of ['HEAD', 'refs/coja/pull/1/head', 'a'.repeat(40), 'abc..def', 'abc...def']) {
      expect(assertRevision(r)).toBe(r)
    }
  })

  it('rejects options, whitespace and empty', () => {
    expect(() => assertRevision('-x')).toThrow(HttpError)
    expect(() => assertRevision('--all')).toThrow(HttpError)
    expect(() => assertRevision('a b')).toThrow(HttpError)
    expect(() => assertRevision('')).toThrow(HttpError)
  })
})

describe('runGit', () => {
  it('runs git with -C and returns stdout as a Buffer', async () => {
    const res = await runGit(dir, ['--version'])
    expect(res.exitCode).toBe(0)
    expect(Buffer.isBuffer(res.stdout)).toBe(true)
    expect(res.stdout.toString()).toMatch(/^git version /)
  })

  it('rejects with a GitError carrying exit code, stderr and args on failure', async () => {
    await expect(runGit(dir, ['rev-parse', '--git-dir'])).rejects.toMatchObject({
      name: 'GitError',
      exitCode: 128,
    })
    const err = await runGit(dir, ['rev-parse', '--git-dir']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitError)
    expect((err as GitError).stderr).toContain('not a git repository')
    expect((err as GitError).message).toContain('git rev-parse failed (exit 128)')
    expect((err as GitError).args).toEqual(['-C', dir, 'rev-parse', '--git-dir'])
  })

  it('treats listed exit codes as success', async () => {
    const res = await runGit(dir, ['rev-parse', '--git-dir'], { okExitCodes: [128] })
    expect(res.exitCode).toBe(128)
  })

  it('truncates stdout at maxBuffer when asked instead of failing', async () => {
    const res = await runGit(dir, ['--version'], { maxBuffer: 4, truncateStdout: true })
    expect(res.truncated).toBe(true)
    expect(res.stdout.toString()).toBe('git ')
    await expect(runGit(dir, ['--version'], { maxBuffer: 4 })).rejects.toThrow(/more output/)
  })

  it('refuses a repository path that looks like an option, as a rejection', async () => {
    await expect(runGit('-C', ['status'])).rejects.toThrow(HttpError)
    await expect(runGitStreaming('-C', ['status'], () => {})).rejects.toThrow(HttpError)
  })

  it('rejects with an abort GitError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = await runGit(dir, ['--version'], { signal: controller.signal }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(GitError)
    expect((err as GitError).message).toContain('was aborted')
    expect((err as GitError).exitCode).toBeNull()
  })

  it('redacts credentials embedded in URLs on stderr', async () => {
    const err = (await runGit(dir, ['ls-remote', 'https://user:secret@127.0.0.1:1/x.git']).catch(
      (e: unknown) => e,
    )) as GitError
    expect(err).toBeInstanceOf(GitError)
    expect(err.stderr).not.toContain('secret')
    expect(err.message).not.toContain('secret')
  })
})

describe('runGitStreaming', () => {
  it('hands stdout to the sink in order and resolves on exit 0', async () => {
    const chunks: Buffer[] = []
    await runGitStreaming(dir, ['--version'], (chunk) => chunks.push(chunk))
    const streamed = Buffer.concat(chunks).toString('utf8')
    expect(streamed).toBe((await runGit(dir, ['--version'])).stdout.toString('utf8'))
    expect(streamed).toMatch(/^git version /)
  })

  it('rejects with a GitError carrying stderr on a non-zero exit', async () => {
    const err = await runGitStreaming(dir, ['rev-parse', '--git-dir'], () => {}).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(GitError)
    expect(err).toMatchObject({ exitCode: 128, args: ['-C', dir, 'rev-parse', '--git-dir'] })
    expect((err as GitError).stderr).toContain('not a git repository')
  })

  it('rejects with an abort GitError when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = await runGitStreaming(dir, ['--version'], () => {}, {
      signal: controller.signal,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitError)
    expect((err as GitError).message).toContain('was aborted')
  })

  it('turns a throwing sink into a GitError', async () => {
    const err = await runGitStreaming(dir, ['--version'], () => {
      throw new Error('sink exploded')
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitError)
    expect((err as GitError).message).toBe('sink exploded')
  })
})
