import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('keeps all relative imports inside the standalone package', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const files = (await readdir(root)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8')
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const module = statement.moduleSpecifier
      if (!module || !ts.isStringLiteral(module)) continue
      const specifier = module.text
      if (specifier.startsWith('.')) {
        expect(
          path.resolve(root, specifier).startsWith(`${root}${path.sep}`),
          `${file}: ${specifier}`,
        ).toBe(true)
      } else {
        expect(['ai', 'zod'], `${file}: ${specifier}`).toContain(specifier)
      }
    }
  }
})
