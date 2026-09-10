import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const packageName = '@ayushporwal/coja'
const registry = 'https://registry.npmjs.org'
const run = (command, args, options = {}) =>
  (execFileSync(command, args, { encoding: 'utf8', ...options }) ?? '').trim()
const git = (...args) => run('git', args)

export function validateVersion(version) {
  assert(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    'Use a stable version, e.g. 0.0.3',
  )
  return version
}

export function compareVersions(a, b) {
  const left = validateVersion(a).split('.').map(BigInt)
  const right = validateVersion(b).split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

export function checkPublished(metadata, version, integrity) {
  assert(
    metadata && typeof metadata.versions === 'object' && metadata.versions !== null,
    'Invalid npm registry metadata',
  )
  assert(typeof metadata['dist-tags']?.latest === 'string', 'npm latest version is missing')
  const published = metadata.versions[version]
  if (published) {
    assert.equal(
      published.dist?.integrity,
      integrity,
      'This version already exists with different contents; choose a new version',
    )
    return true
  }
  const latest = metadata['dist-tags']?.latest
  if (latest) assert(compareVersions(version, latest) > 0, `Version must be newer than ${latest}`)
  return false
}

async function registryMetadata() {
  const response = await fetch(`${registry}/${encodeURIComponent(packageName)}`, {
    signal: AbortSignal.timeout(30_000),
  })
  assert(
    response.ok,
    `npm registry returned ${response.status}; refusing to publish without checking`,
  )
  return response.json()
}

function tagCommit(tag) {
  const refs = git('for-each-ref', '--format=%(refname)', `refs/tags/${tag}`)
  return refs ? git('rev-parse', `${tag}^{commit}`) : undefined
}

export function prepare(sourceRef, version) {
  validateVersion(version)
  assert(sourceRef && !sourceRef.startsWith('-'), 'Supply a commit SHA or ref')
  assert.equal(git('status', '--porcelain'), '', 'Release checkout must be clean')
  const source = git('rev-parse', '--verify', '--end-of-options', `${sourceRef}^{commit}`)
  git('merge-base', '--is-ancestor', source, 'origin/main')
  git('checkout', '--detach', source)
  const manifestPath = 'server/package.json'
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.name, packageName)
  manifest.version = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  git('add', manifestPath)
  const tree = git('write-tree')
  // Deterministic metadata lets a retry recreate exactly the same release commit.
  const date = git('show', '-s', '--format=%cI', source)
  const commit = run('git', ['commit-tree', tree, '-p', source], {
    input: `Release ${version}\n\nSource: ${source}\n`,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'github-actions[bot]',
      GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]',
      GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  })
  git('checkout', '--detach', commit)
  const tag = version // Match the existing 0.0.2 tag convention.
  const existing = tagCommit(tag)
  assert(!existing || existing === commit, `Tag ${tag} already points to another commit`)
  return { source, commit, version, tag }
}

export async function pack(release, artifactDirectory) {
  mkdirSync(artifactDirectory, { recursive: true })
  const [packed] = JSON.parse(
    run('npm', [
      'pack',
      './server',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      artifactDirectory,
    ]),
  )
  assert.equal(packed.name, packageName)
  assert.equal(packed.version, release.version)
  assert(
    packed.files.some((file) => file.path === 'dist/agent/index.js'),
    'Bundled agent is missing',
  )
  assert(
    packed.files.some((file) => file.path === 'public/index.html'),
    'Built web UI is missing',
  )
  const tarball = path.join(artifactDirectory, packed.filename)
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
  assert.equal(integrity, packed.integrity)
  const consumer = path.join(artifactDirectory, 'consumer')
  run('npm', [
    'install',
    '--prefix',
    consumer,
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
  ])
  const installed = path.join(consumer, 'node_modules', packageName)
  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.version, release.version)
  assert(
    !Object.values(manifest.dependencies ?? {}).some((value) => value.startsWith('workspace:')),
  )
  assert(
    run(process.execPath, [path.join(installed, 'bin/coja.js'), '--help'], {
      cwd: consumer,
    }).includes('Usage: coja'),
  )
  const alreadyPublished = checkPublished(await registryMetadata(), release.version, integrity)
  return { ...release, tarball, integrity, alreadyPublished }
}

export async function publish(release) {
  assert.equal(git('rev-parse', 'HEAD'), release.commit)
  const integrity = `sha512-${createHash('sha512').update(readFileSync(release.tarball)).digest('base64')}`
  assert.equal(integrity, release.integrity, 'Tarball changed after validation')
  git('fetch', 'origin', '--tags')
  const existing = tagCommit(release.tag)
  assert(!existing || existing === release.commit, 'Release tag changed; refusing to publish')
  if (!checkPublished(await registryMetadata(), release.version, integrity)) {
    run(
      'npm',
      [
        'publish',
        release.tarball,
        '--provenance',
        '--access',
        'public',
        '--tag',
        'latest',
        '--ignore-scripts',
        '--registry',
        registry,
      ],
      {
        stdio: 'inherit',
        // npm reads these for the attestation's source dependency. Keep the
        // workflow/run identity unchanged; only the code snapshot differs.
        env: { ...process.env, GITHUB_SHA: release.commit, GITHUB_REF: `refs/tags/${release.tag}` },
      },
    )
  }
  // Never announce a release until npm confirms the exact artifact is public.
  let confirmed = false
  let isLatest = false
  for (let attempt = 0; attempt < 12; attempt++) {
    const metadata = await registryMetadata()
    if (metadata.versions?.[release.version]) {
      checkPublished(metadata, release.version, integrity)
      confirmed = true
      isLatest = metadata['dist-tags'].latest === release.version
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  assert(
    confirmed,
    'npm has not confirmed the version yet. Re-run with the same source SHA and version',
  )
  if (!existing) git('tag', release.tag, release.commit)
  git('push', 'origin', `refs/tags/${release.tag}`)
  const repository = process.env.GITHUB_REPOSITORY
  assert(repository, 'GITHUB_REPOSITORY is required')
  // Listing must succeed: authentication/network failures are not mistaken for a missing release.
  const releases = JSON.parse(
    run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`]),
  ).flat()
  if (!releases.some((item) => item.tag_name === release.tag)) {
    run(
      'gh',
      [
        'release',
        'create',
        release.tag,
        '--repo',
        repository,
        '--verify-tag',
        '--title',
        release.tag,
        `--latest=${isLatest}`,
        '--notes',
        `Publishes ${packageName}@${release.version}.\n\nSource commit: ${release.source}\nRelease commit: ${release.commit}\n\nInstall: npm install -g ${packageName}@${release.version}`,
      ],
      { stdio: 'inherit' },
    )
  }
}

export async function main(args = process.argv.slice(2)) {
  const [command, metadataPath, artifactDirectory] = args
  if (command === 'prepare') {
    const release = prepare(process.env.RELEASE_SOURCE, process.env.RELEASE_VERSION)
    writeFileSync(metadataPath, JSON.stringify(release, null, 2))
  } else if (command === 'pack') {
    const release = await pack(JSON.parse(readFileSync(metadataPath, 'utf8')), artifactDirectory)
    writeFileSync(metadataPath, JSON.stringify(release, null, 2))
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Release ${release.version}\n\nSource: ${release.source}\n\nRelease commit: ${release.commit}\n\nTarball integrity: ${release.integrity}\n\nAlready published: ${release.alreadyPublished}\n\nDry run: ${process.env.DRY_RUN}\n`,
      )
  } else if (command === 'publish') {
    await publish(JSON.parse(readFileSync(metadataPath, 'utf8')))
  } else {
    throw new Error('Expected prepare, pack, or publish')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
