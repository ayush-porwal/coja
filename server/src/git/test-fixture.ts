import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runGit } from './run.js'

/**
 * Test-only: builds a small "GitHub" in a temp directory. Not PR code — these
 * are repositories the tests author themselves.
 *
 *   origin.git   bare, plays github.com: `main` plus `refs/pull/1/head`
 *   local        the user's working clone of it; its `origin` URL is
 *                https://github.com/acme/widgets.git, rewritten to origin.git
 *                through a repo-local `url.<dir>.insteadOf`, so project code
 *                sees a GitHub remote while fetches stay on disk
 *   work         scratch clone used only to author commits
 *
 * PR #1 (`feature` → `main`) adds, edits, renames (with a small change) and
 * deletes files and adds a binary; `main` moves on after the branch point so
 * the merge base differs from the base branch tip.
 */

export const FIXTURE_REMOTE_URL = 'https://github.com/acme/widgets.git'

/** Fixed identity and dates: isolated from the user's git config, deterministic output. */
const FIXTURE_ENV: NodeJS.ProcessEnv = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Ada Lovelace',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada Lovelace',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_AUTHOR_DATE: '2024-01-02T03:04:05+00:00',
  GIT_COMMITTER_DATE: '2024-01-02T03:04:05+00:00',
}

/** The same instant as git prints it with `--date=iso-strict` / `%aI`. */
export const FIXTURE_AUTHOR_DATE = '2024-01-02T03:04:05Z'

export const APP_TS_BASE = [
  'export function app(): string {',
  "  const greeting = 'hello'",
  "  const flag = '-weird'",
  "  return greeting + ' ' + flag",
  '}',
  '',
  'export const VERSION = 1',
  '',
  'function helper(): void {',
  '  // nothing yet',
  '}',
  '',
  'export { helper }',
  '',
].join('\n')

export const APP_TS_HEAD = APP_TS_BASE.replace(
  "const greeting = 'hello'",
  "const greeting = 'HELLO'",
)

const HELPERS_BASE = Array.from({ length: 12 }, (_, i) => `export const h${i + 1} = ${i + 1}`)
  .join('\n')
  .concat('\n')

const HELPERS_HEAD = HELPERS_BASE.replace('export const h12 = 12', 'export const h12 = 1200')

export interface Fixture {
  root: string
  /** Bare repository standing in for github.com. */
  originDir: string
  /** The user's working clone (a `local` project). */
  localDir: string
  /** Scratch clone with a checkout, for authoring more commits. */
  workDir: string
  /** Merge base of `main` and PR #1. */
  baseOid: string
  /** Tip of `main` (one commit past the merge base). */
  mainOid: string
  /** `refs/pull/1/head`. */
  headOid: string
  /** Fixture-authoring git (isolated config, fixed identity). */
  git(dir: string, args: readonly string[]): Promise<string>
  /** Push one more commit to `refs/pull/1/head`; returns the new head oid. */
  advancePrHead(): Promise<string>
  /** Clone origin bare into `dir` (an app-managed `clone` project without the network). */
  cloneBareLocal(dir: string): Promise<void>
  cleanup(): Promise<void>
}

export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coja-fixture-'))
  const originDir = path.join(root, 'origin.git')
  const workDir = path.join(root, 'work')
  const localDir = path.join(root, 'local')

  const git = async (dir: string, args: readonly string[]): Promise<string> =>
    (await runGit(dir, args, { env: FIXTURE_ENV })).stdout.toString('utf8').trim()

  // --- origin (bare) and the base commit on main ----------------------------
  await mkdir(originDir)
  await git(originDir, ['init', '--quiet', '--bare', '-b', 'main'])
  // Let tests fetch commits by oid even if this machine's git speaks protocol v1.
  await git(originDir, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])

  await mkdir(workDir)
  await git(workDir, ['init', '--quiet', '-b', 'main'])
  await writeTree(workDir, {
    'README.md': '# widgets\n',
    'src/app.ts': APP_TS_BASE,
    'src/legacy/helpers.ts': HELPERS_BASE,
    'src/remove-me.ts': 'export const gone = true\n',
    'app/[id]/page.tsx': 'export default function Page() {\n  return null\n}\n',
    'docs/notes.md': 'Notes about widgets.\n',
  })
  await git(workDir, ['add', '-A'])
  await git(workDir, ['commit', '--quiet', '--no-gpg-sign', '-m', 'Initial import'])
  const baseOid = await git(workDir, ['rev-parse', 'HEAD'])
  await git(workDir, ['remote', 'add', 'origin', originDir])
  await git(workDir, ['push', '--quiet', 'origin', 'main'])

  // --- the PR branch ---------------------------------------------------------
  await git(workDir, ['checkout', '--quiet', '-b', 'feature'])
  await writeTree(workDir, {
    'src/app.ts': APP_TS_HEAD,
    'src/feature.ts': 'export const feature = () => 42\n',
    'app/[id]/page.tsx': 'export default function Page() {\n  return <div>id</div>\n}\n',
  })
  await mkdir(path.join(workDir, 'src/util'), { recursive: true })
  await git(workDir, ['mv', 'src/legacy/helpers.ts', 'src/util/helpers.ts'])
  await writeFile(path.join(workDir, 'src/util/helpers.ts'), HELPERS_HEAD)
  await git(workDir, ['rm', '--quiet', 'src/remove-me.ts'])
  await mkdir(path.join(workDir, 'assets'), { recursive: true })
  await writeFile(
    path.join(workDir, 'assets/logo.bin'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0xff, 0x00, 0x10]),
  )
  await git(workDir, ['add', '-A'])
  await git(workDir, [
    'commit',
    '--quiet',
    '--no-gpg-sign',
    '-m',
    'Add feature and tidy helpers',
    '-m',
    'Renames the legacy helpers and drops remove-me.',
  ])
  const headOid = await git(workDir, ['rev-parse', 'HEAD'])
  await git(workDir, ['push', '--quiet', 'origin', 'feature:refs/pull/1/head'])

  // --- main moves on, so merge base != base tip ------------------------------
  await git(workDir, ['checkout', '--quiet', 'main'])
  await writeTree(workDir, { 'README.md': '# widgets\n\nNow with docs.\n' })
  await git(workDir, ['add', '-A'])
  await git(workDir, ['commit', '--quiet', '--no-gpg-sign', '-m', 'Main moves on'])
  const mainOid = await git(workDir, ['rev-parse', 'HEAD'])
  await git(workDir, ['push', '--quiet', 'origin', 'main'])

  // --- the user's clone ------------------------------------------------------
  await git(root, ['clone', '--quiet', originDir, localDir])
  await git(localDir, ['config', 'remote.origin.url', FIXTURE_REMOTE_URL])
  await git(localDir, ['config', `url.${originDir}.insteadOf`, FIXTURE_REMOTE_URL])

  return {
    root,
    originDir,
    localDir,
    workDir,
    baseOid,
    mainOid,
    headOid,
    git,
    async advancePrHead() {
      await git(workDir, ['checkout', '--quiet', 'feature'])
      await writeTree(workDir, { 'src/feature.ts': 'export const feature = () => 43\n' })
      await git(workDir, ['add', '-A'])
      await git(workDir, ['commit', '--quiet', '--no-gpg-sign', '-m', 'Bump the answer'])
      const oid = await git(workDir, ['rev-parse', 'HEAD'])
      await git(workDir, ['push', '--quiet', 'origin', 'feature:refs/pull/1/head'])
      await git(workDir, ['checkout', '--quiet', 'main'])
      return oid
    },
    async cloneBareLocal(dir: string) {
      await mkdir(path.dirname(dir), { recursive: true })
      await git(root, ['clone', '--quiet', '--bare', originDir, dir])
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}
