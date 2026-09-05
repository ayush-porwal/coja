// @vitest-environment node
import { parsePatchFiles } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'

// A `git diff <mergeBase> <head>` for a rename with a small change followed by an added file —
// the shape the server returns per file (one file per patch) and what CodeView items are built from.
const RENAME_WITH_CHANGE = [
  'diff --git a/src/auth/token.ts b/src/auth/bearer.ts',
  'similarity index 85%',
  'rename from src/auth/token.ts',
  'rename to src/auth/bearer.ts',
  'index 1111111..2222222 100644',
  '--- a/src/auth/token.ts',
  '+++ b/src/auth/bearer.ts',
  '@@ -1,4 +1,4 @@',
  ' export interface Token {',
  '   value: string',
  '-  expires: number',
  '+  expiresAt: number',
  ' }',
  '',
].join('\n')

const ADDED_FILE = [
  'diff --git a/src/auth/audit.ts b/src/auth/audit.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/auth/audit.ts',
  '@@ -0,0 +1,3 @@',
  '+export function audit(event: string): void {',
  '+  console.log(event)',
  '+}',
  '',
].join('\n')

const PURE_RENAME = [
  'diff --git a/docs/old.md b/docs/new.md',
  'similarity index 100%',
  'rename from docs/old.md',
  'rename to docs/new.md',
  '',
].join('\n')

describe('parsePatchFiles on real git output', () => {
  it('parses a rename with a change (name, prevName, type, hunk)', () => {
    const files = parsePatchFiles(RENAME_WITH_CHANGE, 'pr1:src/auth/bearer.ts').flatMap(
      (p) => p.files,
    )
    expect(files).toHaveLength(1)
    const file = files[0]
    expect(file?.name).toBe('src/auth/bearer.ts')
    expect(file?.prevName).toBe('src/auth/token.ts')
    expect(file?.type).toBe('rename-changed')
    expect(file?.hunks).toHaveLength(1)
    expect(file?.hunks[0]?.additionCount).toBe(4)
    expect(file?.hunks[0]?.deletionCount).toBe(4)
    expect(file?.isPartial).toBe(true)
  })

  it('parses an added file', () => {
    const files = parsePatchFiles(ADDED_FILE, 'pr1:src/auth/audit.ts').flatMap((p) => p.files)
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe('src/auth/audit.ts')
    expect(files[0]?.type).toBe('new')
    expect(files[0]?.additionLines).toHaveLength(3)
  })

  it('parses a pure rename without hunks', () => {
    const files = parsePatchFiles(PURE_RENAME, 'pr1:docs/new.md').flatMap((p) => p.files)
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe('docs/new.md')
    expect(files[0]?.prevName).toBe('docs/old.md')
    expect(files[0]?.type).toBe('rename-pure')
    expect(files[0]?.hunks).toHaveLength(0)
  })

  it('parses a multi-file diff into one ParsedPatch with both files in order', () => {
    const parsed = parsePatchFiles(RENAME_WITH_CHANGE + ADDED_FILE, 'pr1')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.files.map((f) => f.name)).toEqual(['src/auth/bearer.ts', 'src/auth/audit.ts'])
  })
})
