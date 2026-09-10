import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(new URL('../', import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), 'coja-package-'))
try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], {
      cwd: server,
      encoding: 'utf8',
    }),
  )[0]
  assert(packed.files.some((file) => file.path === 'dist/agent/index.js'))
  const install = path.join(temp, 'consumer')
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      install,
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(temp, packed.filename),
    ],
    { stdio: 'inherit' },
  )
  const installed = path.join(install, 'node_modules/@ayushporwal/coja')
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
  assert(!manifest.dependencies['@coja/agent'])
  assert(!Object.values(manifest.dependencies).some((version) => version.startsWith('workspace:')))
  const help = execFileSync(process.execPath, [path.join(installed, 'bin/coja.js'), '--help'], {
    cwd: install,
    encoding: 'utf8',
  })
  assert(help.includes('Usage: coja'))
  console.log('Packed CLI installs and starts outside the workspace with its included agent.')
} finally {
  await rm(temp, { recursive: true, force: true })
}
