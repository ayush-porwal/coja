import { describe, expect, it } from 'vitest'
import {
  citationUrl,
  linkifyCitations,
  type MdNode,
  parseCitationUrl,
  remarkCitations,
  resolveCitationPath,
} from './citations'

const paths = [
  'src/auth.ts',
  'src/util/ttl.ts',
  'test/auth.test.ts',
  'Dockerfile',
  'lib/a/x.ts',
  'lib/b/x.ts',
]

describe('linkifyCitations', () => {
  it('links an exact path with a single line', () => {
    expect(linkifyCitations('See src/auth.ts:41 for the check.', paths)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'citation', text: 'src/auth.ts:41', path: 'src/auth.ts', line: 41 },
      { kind: 'text', text: ' for the check.' },
    ])
  })

  it('links ranges (hyphen or en dash) and GitHub-style #L anchors', () => {
    expect(linkifyCitations('src/auth.ts:41-58', paths)).toEqual([
      { kind: 'citation', text: 'src/auth.ts:41-58', path: 'src/auth.ts', line: 41, endLine: 58 },
    ])
    expect(linkifyCitations('src/auth.ts:41–58', paths)[0]).toMatchObject({ line: 41, endLine: 58 })
    expect(linkifyCitations('src/auth.ts#L41-L58', paths)[0]).toMatchObject({
      kind: 'citation',
      line: 41,
      endLine: 58,
    })
    expect(linkifyCitations('src/auth.ts#L7', paths)[0]).toMatchObject({
      kind: 'citation',
      line: 7,
    })
  })

  it('suffix-matches at a slash boundary, including bare file names', () => {
    expect(linkifyCitations('in ttl.ts:3', paths)).toEqual([
      { kind: 'text', text: 'in ' },
      { kind: 'citation', text: 'ttl.ts:3', path: 'src/util/ttl.ts', line: 3 },
    ])
    expect(linkifyCitations('util/ttl.ts:3', paths)[0]).toMatchObject({ path: 'src/util/ttl.ts' })
    expect(
      linkifyCitations('./src/auth.ts:1 and /src/auth.ts:2', paths).filter(
        (s) => s.kind === 'citation',
      ),
    ).toHaveLength(2)
  })

  it('leaves unknown, ambiguous and non-boundary paths alone', () => {
    const text =
      'src/other.ts:12, x.ts:4 is ambiguous, tauth.ts:1, 12:30, https://example.com/a.ts:1'
    expect(linkifyCitations(text, paths)).toEqual([{ kind: 'text', text }])
    // `ttl.ts:3` inside a longer path token is not a citation of ttl.ts
    expect(linkifyCitations('other/ttl.ts:3', paths)).toEqual([
      { kind: 'text', text: 'other/ttl.ts:3' },
    ])
  })

  it('does not match when the line number runs into a word or is missing', () => {
    expect(linkifyCitations('src/auth.ts:41abc', paths)).toEqual([
      { kind: 'text', text: 'src/auth.ts:41abc' },
    ])
    expect(linkifyCitations('src/auth.ts', paths)).toEqual([{ kind: 'text', text: 'src/auth.ts' }])
    expect(linkifyCitations('', paths)).toEqual([])
  })

  it('handles several citations and punctuation around them', () => {
    const segments = linkifyCitations('(Dockerfile:3) and `src/auth.ts:9`.', paths)
    expect(segments.filter((s) => s.kind === 'citation').map((s) => s.text)).toEqual([
      'Dockerfile:3',
      'src/auth.ts:9',
    ])
  })

  it('ignores an inverted range end', () => {
    expect(linkifyCitations('src/auth.ts:10-5', paths)[0]).toEqual({
      kind: 'citation',
      text: 'src/auth.ts:10-5',
      path: 'src/auth.ts',
      line: 10,
    })
  })
})

describe('resolveCitationPath', () => {
  it('prefers exact matches and refuses ambiguous suffixes', () => {
    expect(resolveCitationPath('src/auth.ts', paths)).toBe('src/auth.ts')
    expect(resolveCitationPath('auth.ts', paths)).toBe('src/auth.ts')
    expect(resolveCitationPath('x.ts', paths)).toBeUndefined()
    expect(resolveCitationPath('a/x.ts', paths)).toBe('lib/a/x.ts')
    expect(resolveCitationPath('nope.ts', paths)).toBeUndefined()
  })
})

describe('citation urls', () => {
  it('round-trips through the coja-cite scheme', () => {
    const url = citationUrl({ path: 'src/a b.ts', line: 3, endLine: 9 })
    expect(url).toBe('coja-cite:3-9:src%2Fa%20b.ts')
    expect(parseCitationUrl(url)).toEqual({ path: 'src/a b.ts', line: 3, endLine: 9 })
    expect(parseCitationUrl('coja-cite:7:x.ts')).toEqual({ path: 'x.ts', line: 7 })
    expect(parseCitationUrl('https://example.com')).toBeUndefined()
    expect(parseCitationUrl('coja-cite:garbage')).toBeUndefined()
  })
})

describe('remarkCitations', () => {
  const run = (tree: MdNode) => {
    remarkCitations({ paths })(tree)
    return tree
  }

  it('splits text nodes into text and link nodes, skipping code blocks and links', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'See src/auth.ts:41 here' },
            {
              type: 'link',
              url: 'https://x',
              children: [{ type: 'text', value: 'src/auth.ts:1' }],
            },
          ],
        },
        { type: 'code', value: 'src/auth.ts:2' },
      ],
    }
    run(tree)
    const paragraph = tree.children?.[0]
    expect(paragraph?.children?.map((c) => c.type)).toEqual(['text', 'link', 'text', 'link'])
    expect(paragraph?.children?.[1]).toEqual({
      type: 'link',
      url: 'coja-cite:41:src%2Fauth.ts',
      title: null,
      children: [{ type: 'text', value: 'src/auth.ts:41' }],
    })
    // the pre-existing link and the fenced code block are untouched
    expect(paragraph?.children?.[3]?.children?.[0]).toEqual({
      type: 'text',
      value: 'src/auth.ts:1',
    })
    expect(tree.children?.[1]).toEqual({ type: 'code', value: 'src/auth.ts:2' })
  })

  it('wraps an inline code span that is exactly one citation', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'src/auth.ts:41-58' },
            { type: 'inlineCode', value: 'const x = src/auth.ts:41' },
          ],
        },
      ],
    }
    run(tree)
    const [wrapped, untouched] = tree.children?.[0]?.children ?? []
    expect(wrapped).toEqual({
      type: 'link',
      url: 'coja-cite:41-58:src%2Fauth.ts',
      title: null,
      children: [{ type: 'inlineCode', value: 'src/auth.ts:41-58' }],
    })
    expect(untouched).toEqual({ type: 'inlineCode', value: 'const x = src/auth.ts:41' })
  })
})
