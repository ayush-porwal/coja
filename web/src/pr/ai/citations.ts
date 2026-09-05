/**
 * Citations in agent output navigate the diff (design.md §4): a `path:line`
 * or `path:start-end` token whose path is one of the PR's changed files
 * becomes a link that scrolls the diff there.
 *
 * `linkifyCitations` is the pure splitter; `remarkCitations` applies it to the
 * markdown AST so citations inside paragraphs, list items, table cells and
 * inline code all become `coja-cite:` links, which the markdown renderer turns
 * into buttons. Fenced code blocks and existing links are left untouched.
 */

export interface TextSegment {
  kind: 'text'
  text: string
}

export interface CitationSegment {
  kind: 'citation'
  /** The token as written, e.g. `auth.ts:41-58`. */
  text: string
  /** The resolved changed-file path, e.g. `src/auth.ts`. */
  path: string
  line: number
  endLine?: number
}

export type Segment = TextSegment | CitationSegment

/**
 * `[./|/]segment(/segment)*` followed by `:line[-end]` or GitHub's `#Lline[-Lend]`.
 * The path may not start inside a word or right after a slash, and the line
 * number may not run into a word character.
 */
const CITATION_RE =
  /(?<![\w/-])(?:\.\/|\/)?([\w.@+-]+(?:\/[\w.@+-]+)*)(?::(\d+)(?:[-–](\d+))?|#L(\d+)(?:-L?(\d+))?)(?!\w)/g

/**
 * The changed file a cited path refers to: an exact match, or the only file
 * that ends with `/<candidate>`. Ambiguous suffixes resolve to nothing so we
 * never jump to the wrong file.
 */
export function resolveCitationPath(
  candidate: string,
  paths: readonly string[],
): string | undefined {
  if (paths.includes(candidate)) return candidate
  const suffix = `/${candidate}`
  let found: string | undefined
  for (const path of paths) {
    if (path.endsWith(suffix)) {
      if (found !== undefined) return undefined
      found = path
    }
  }
  return found
}

/** Splits `text` into plain segments and citations of files in `paths`. */
export function linkifyCitations(text: string, paths: readonly string[]): Segment[] {
  const segments: Segment[] = []
  if (text === '') return segments
  let last = 0
  for (const match of text.matchAll(CITATION_RE)) {
    const [token, rawPath, colonLine, colonEnd, hashLine, hashEnd] = match
    const path = rawPath === undefined ? undefined : resolveCitationPath(rawPath, paths)
    const lineText = colonLine ?? hashLine
    if (path === undefined || lineText === undefined) continue
    const line = Number.parseInt(lineText, 10)
    const endText = colonEnd ?? hashEnd
    const endLine = endText === undefined ? undefined : Number.parseInt(endText, 10)
    if (!Number.isFinite(line) || line < 1) continue
    const start = match.index
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) })
    segments.push({
      kind: 'citation',
      text: token,
      path,
      line,
      ...(endLine !== undefined && endLine >= line ? { endLine } : {}),
    })
    last = start + token.length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

// ---------------------------------------------------------------------------
// `coja-cite:` URLs — how a citation travels through the markdown pipeline
// ---------------------------------------------------------------------------

export const CITE_SCHEME = 'coja-cite:'

export interface CitationTarget {
  path: string
  line: number
  endLine?: number
}

/** `coja-cite:41-58:src%2Fauth.ts` */
export function citationUrl(target: CitationTarget): string {
  const range = target.endLine === undefined ? `${target.line}` : `${target.line}-${target.endLine}`
  return `${CITE_SCHEME}${range}:${encodeURIComponent(target.path)}`
}

export function parseCitationUrl(url: string): CitationTarget | undefined {
  if (!url.startsWith(CITE_SCHEME)) return undefined
  const m = /^(\d+)(?:-(\d+))?:(.+)$/.exec(url.slice(CITE_SCHEME.length))
  if (!m) return undefined
  const [, lineText, endText, encoded] = m
  if (lineText === undefined || encoded === undefined) return undefined
  try {
    const target: CitationTarget = { path: decodeURIComponent(encoded), line: Number(lineText) }
    if (endText !== undefined) target.endLine = Number(endText)
    return target
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// remark plugin
// ---------------------------------------------------------------------------

/**
 * Minimal structural view of mdast nodes — enough to walk the tree and
 * rewrite text without depending on the (transitive) mdast type packages.
 */
export interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdNode[]
}

/** Never descend into these: code stays verbatim, existing links stay links. */
const SKIP = new Set([
  'code',
  'link',
  'linkReference',
  'definition',
  'html',
  'image',
  'imageReference',
])

/** remark plugin: `[remarkCitations, { paths }]`. */
export function remarkCitations(options: { paths: readonly string[] }) {
  const paths = options.paths
  return (tree: MdNode) => {
    rewrite(tree, paths)
  }
}

function rewrite(node: MdNode, paths: readonly string[]): void {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const segments = linkifyCitations(child.value, paths)
      if (segments.some((s) => s.kind === 'citation')) {
        for (const segment of segments) {
          next.push(
            segment.kind === 'text'
              ? { type: 'text', value: segment.text }
              : {
                  type: 'link',
                  url: citationUrl(segment),
                  title: null,
                  children: [{ type: 'text', value: segment.text }],
                },
          )
        }
        continue
      }
    } else if (child.type === 'inlineCode' && typeof child.value === 'string') {
      // `src/auth.ts:41` — the whole code span must be exactly one citation.
      const segments = linkifyCitations(child.value.trim(), paths)
      const only = segments.length === 1 ? segments[0] : undefined
      if (only?.kind === 'citation') {
        next.push({ type: 'link', url: citationUrl(only), title: null, children: [child] })
        continue
      }
    } else if (!SKIP.has(child.type)) {
      rewrite(child, paths)
    }
    next.push(child)
  }
  node.children = next
}
