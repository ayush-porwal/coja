import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  checkPublished,
  compareVersions,
  main,
  pack,
  prepare,
  publish,
  validateVersion,
} from './release.mjs'

test('release versions are explicit stable semver, not shell commands or refs', () => {
  for (const version of ['0.0.3', '1.10.0']) assert.equal(validateVersion(version), version)
  for (const version of ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta.1', '$(echo bad)', '1.0.0\n']) {
    assert.throws(() => validateVersion(version))
  }
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1)
})

test('publication retries require identical bytes and new versions must advance latest', () => {
  const metadata = {
    'dist-tags': { latest: '1.2.0' },
    versions: { '1.2.0': { dist: { integrity: 'same' } } },
  }
  assert.equal(checkPublished(metadata, '1.2.0', 'same'), true)
  assert.throws(() => checkPublished(metadata, '1.2.0', 'different'))
  assert.throws(() => checkPublished(metadata, '1.1.0', 'new'))
  assert.equal(checkPublished(metadata, '1.3.0', 'new'), false)
  assert.throws(() => checkPublished({}, '1.3.0', 'new'))
})

test('selected main ancestor gets a reproducible version-only commit without moving main', () => {
  const initialDirectory = process.cwd()
  const directory = mkdtempSync(path.join(os.tmpdir(), 'coja-release-test-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  try {
    process.chdir(directory)
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    mkdirSync('server')
    writeFileSync('server/package.json', '{"name":"@ayushporwal/coja","version":"0.0.2"}\n')
    git('add', '.')
    git('commit', '-m', 'source')
    const source = git('rev-parse', 'HEAD')
    writeFileSync('later.txt', 'not in the selected release')
    git('add', '.')
    git('commit', '-m', 'later')
    const main = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', main)
    const first = prepare(source, '0.0.3')
    assert.equal(git('rev-parse', 'main'), main)
    assert.equal(git('rev-parse', 'HEAD^'), source)
    assert.equal(git('diff', '--name-only', source, first.commit), 'server/package.json')
    assert.equal(JSON.parse(readFileSync('server/package.json', 'utf8')).version, '0.0.3')
    assert.equal(git('status', '--porcelain'), '')
    const retry = prepare(source, '0.0.3')
    assert.deepEqual(retry, first)
    git('tag', '0.0.3', first.commit)
    assert.deepEqual(prepare(source, '0.0.3'), first)
    assert.throws(() => prepare(main, '0.0.3'), /another commit/)
    git('checkout', '--detach', main)
    assert.throws(() => prepare(first.commit, '0.0.4')) // release commit is not in main history
    assert.throws(() => prepare('--help', '0.0.4'))
    writeFileSync('dirty.txt', 'unrelated work')
    assert.throws(() => prepare(source, '0.0.4'), /clean/)
  } finally {
    process.chdir(initialDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pack installs the exact tarball and rejects registry failures and mismatched published bytes', async () => {
  const initialDirectory = process.cwd()
  const directory = mkdtempSync(path.join(os.tmpdir(), 'coja-release-pack-'))
  const originalFetch = globalThis.fetch
  const originalCache = process.env.npm_config_cache
  const originalOffline = process.env.npm_config_offline
  process.env.npm_config_cache = path.join(directory, 'npm-cache')
  process.env.npm_config_offline = 'true'
  try {
    process.chdir(directory)
    mkdirSync('server/dist/agent', { recursive: true })
    mkdirSync('server/public', { recursive: true })
    mkdirSync('server/bin', { recursive: true })
    writeFileSync(
      'server/package.json',
      JSON.stringify({
        name: '@ayushporwal/coja',
        version: '0.0.3',
        bin: { coja: 'bin/coja.js' },
        files: ['bin', 'dist', 'public'],
      }),
    )
    writeFileSync('server/dist/agent/index.js', '')
    writeFileSync('server/public/index.html', '<html></html>')
    writeFileSync('server/bin/coja.js', "console.log('Usage: coja')")
    const metadata = { versions: {}, 'dist-tags': { latest: '0.0.2' } }
    globalThis.fetch = async () => ({ ok: true, json: async () => metadata })
    const release = { version: '0.0.3' }
    const summary = process.env.GITHUB_STEP_SUMMARY
    delete process.env.GITHUB_STEP_SUMMARY
    const metadataPath = path.join(directory, 'release.json')
    writeFileSync(metadataPath, JSON.stringify(release))
    try {
      await main(['pack', metadataPath, path.join(directory, 'first')])
    } finally {
      if (summary !== undefined) process.env.GITHUB_STEP_SUMMARY = summary
    }
    const first = JSON.parse(readFileSync(metadataPath, 'utf8'))
    assert.equal(first.alreadyPublished, false)
    metadata.versions['0.0.3'] = { dist: { integrity: first.integrity } }
    const retry = await pack(release, path.join(directory, 'retry'))
    assert.equal(retry.integrity, first.integrity)
    assert.equal(retry.alreadyPublished, true)
    metadata.versions['0.0.3'].dist.integrity = 'different'
    await assert.rejects(pack(release, path.join(directory, 'conflict')), /different contents/)
    globalThis.fetch = async () => ({ ok: false, status: 503 })
    await assert.rejects(pack(release, path.join(directory, 'offline')), /registry returned 503/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalCache === undefined) delete process.env.npm_config_cache
    else process.env.npm_config_cache = originalCache
    if (originalOffline === undefined) delete process.env.npm_config_offline
    else process.env.npm_config_offline = originalOffline
    process.chdir(initialDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('publish resumes GitHub completion without republishing and never tags a failed publication', async () => {
  const initialDirectory = process.cwd()
  const directory = mkdtempSync(path.join(os.tmpdir(), 'coja-publish-test-'))
  const originalFetch = globalThis.fetch
  const originalPath = process.env.PATH
  const originalRepository = process.env.GITHUB_REPOSITORY
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  try {
    process.chdir(directory)
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    writeFileSync('source.txt', 'source')
    git('add', '.')
    git('commit', '-m', 'source')
    const commit = git('rev-parse', 'HEAD')
    const remote = path.join(directory, 'remote.git')
    git('init', '--bare', remote)
    git('remote', 'add', 'origin', remote)
    git('push', 'origin', 'main')
    const binaries = path.join(directory, 'fake-bin')
    mkdirSync(binaries)
    const publishMarker = path.join(directory, 'npm-published')
    const releaseMarker = path.join(directory, 'github-release')
    const failedMarker = path.join(directory, 'fail-publish')
    const provenanceMarker = path.join(directory, 'provenance-env.json')
    const npmScript = `#!${process.execPath}\nconst fs = require('node:fs'); if (fs.existsSync(${JSON.stringify(failedMarker)})) process.exit(1); fs.writeFileSync(${JSON.stringify(provenanceMarker)}, JSON.stringify({sha:process.env.GITHUB_SHA,ref:process.env.GITHUB_REF,workflow:process.env.GITHUB_WORKFLOW_REF})); fs.appendFileSync(${JSON.stringify(publishMarker)}, 'published\\n')\n`
    const ghScript = `#!${process.execPath}\nconst fs = require('node:fs'); if (process.argv[2] === 'api') console.log(JSON.stringify([fs.existsSync(${JSON.stringify(releaseMarker)}) ? [{tag_name:'0.0.3'}] : []])); else fs.writeFileSync(${JSON.stringify(releaseMarker)}, 'created')\n`
    for (const [name, script] of [
      ['npm', npmScript],
      ['gh', ghScript],
    ]) {
      writeFileSync(path.join(binaries, name), script)
      chmodSync(path.join(binaries, name), 0o755)
    }
    process.env.PATH = `${binaries}${path.delimiter}${originalPath}`
    process.env.GITHUB_REPOSITORY = 'fixture/coja'
    const tarball = path.join(directory, 'release.tgz')
    writeFileSync(tarball, 'validated artifact')
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
    const release = { commit, source: commit, version: '0.0.3', tag: '0.0.3', tarball, integrity }
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        versions: existsSync(publishMarker) ? { '0.0.3': { dist: { integrity } } } : {},
        'dist-tags': { latest: existsSync(publishMarker) ? '0.0.3' : '0.0.2' },
      }),
    })
    writeFileSync(failedMarker, '')
    await assert.rejects(publish(release))
    assert.equal(git('tag', '--list'), '')
    assert.equal(existsSync(releaseMarker), false)
    rmSync(failedMarker)
    await publish(release)
    assert.equal(git('ls-remote', 'origin', 'refs/tags/0.0.3'), `${commit}\trefs/tags/0.0.3`)
    assert.equal(existsSync(releaseMarker), true)
    assert.deepEqual(JSON.parse(readFileSync(provenanceMarker, 'utf8')), {
      sha: commit,
      ref: 'refs/tags/0.0.3',
      ...(process.env.GITHUB_WORKFLOW_REF ? { workflow: process.env.GITHUB_WORKFLOW_REF } : {}),
    })
    rmSync(releaseMarker) // Simulate missing GitHub release after successful npm publication.
    await publish(release)
    assert.equal(readFileSync(publishMarker, 'utf8'), 'published\n')
    assert.equal(existsSync(releaseMarker), true)
    writeFileSync(tarball, 'tampered')
    await assert.rejects(publish(release), /changed after validation/)
  } finally {
    globalThis.fetch = originalFetch
    process.env.PATH = originalPath
    if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY
    else process.env.GITHUB_REPOSITORY = originalRepository
    process.chdir(initialDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})
