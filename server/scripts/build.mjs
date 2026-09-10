import { execFileSync } from 'node:child_process'
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const server = fileURLToPath(new URL('../', import.meta.url))
const agent = path.resolve(server, '../packages/agent')
const output = path.join(server, 'dist')
const bundled = path.join(output, 'agent')

// Keep one shared agent module graph in the CLI so class identities survive.
// Source imports still use the standalone workspace package during development.
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {
    cwd: agent,
    stdio: 'inherit',
  },
)
await rm(output, { recursive: true, force: true })
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {
    cwd: server,
    stdio: 'inherit',
  },
)
const manifest = JSON.parse(await readFile(path.join(agent, 'package.json'), 'utf8'))
const files = await readdir(output, { recursive: true })
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const target = path.join(output, file)
  let source = await readFile(target, 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const edits = []
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (!specifier || !ts.isStringLiteral(specifier)) continue
    const name = specifier.text
    if (name !== '@coja/agent' && !name.startsWith('@coja/agent/')) continue
    const entry =
      manifest.exports[name === '@coja/agent' ? '.' : `.${name.slice('@coja/agent'.length)}`]
        ?.default
    if (!entry?.startsWith('./dist/')) throw new Error(`Unknown agent export: ${name}`)
    const destination = path.join(bundled, entry.slice('./dist/'.length))
    let relative = path.relative(path.dirname(target), destination).split(path.sep).join('/')
    if (!relative.startsWith('.')) relative = `./${relative}`
    edits.push({
      start: specifier.getStart(parsed),
      end: specifier.end,
      text: JSON.stringify(relative),
    })
  }
  for (const edit of edits.reverse()) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  }
  await writeFile(target, source)
}
await cp(path.join(agent, 'dist'), bundled, { recursive: true })
