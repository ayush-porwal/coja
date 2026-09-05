import { useMemo } from 'react'
import Markdown, { defaultUrlTransform, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { bridge } from '../bridge'
import { CITE_SCHEME, parseCitationUrl, remarkCitations } from './citations'

type RemarkPlugins = NonNullable<Options['remarkPlugins']>
type Components = NonNullable<Options['components']>

/** Lets our `coja-cite:` links through; everything else keeps react-markdown's default sanitising. */
function urlTransform(url: string): string {
  return url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url)
}

const citeClass =
  'inline rounded-sm px-0.5 font-mono text-[0.9em] text-blue-700 underline decoration-dotted hover:bg-blue-50 hover:decoration-solid dark:text-blue-300 dark:hover:bg-blue-950'

const components: Components = {
  a: ({ href, children, node: _node, ...rest }) => {
    const cite = href === undefined ? undefined : parseCitationUrl(href)
    if (cite) {
      const where =
        cite.endLine === undefined ? `line ${cite.line}` : `lines ${cite.line}–${cite.endLine}`
      return (
        <button
          type="button"
          className={citeClass}
          title={`Open ${cite.path} at ${where}`}
          onClick={() => bridge.scrollToLine({ path: cite.path, line: cite.line, side: 'RIGHT' })}
        >
          {children}
        </button>
      )
    }
    // react-markdown blanks unsafe schemes (javascript:, data:…); show those as plain text.
    if (!href) return <span {...rest}>{children}</span>
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    )
  },
}

export interface AssistantMarkdownProps {
  text: string
  /** Changed-file paths; `path:line` tokens for these become citation buttons. */
  paths: readonly string[]
}

/** Assistant text: GFM markdown with `file:line` citations that scroll the diff. */
export function AssistantMarkdown({ text, paths }: AssistantMarkdownProps) {
  const plugins = useMemo<RemarkPlugins>(() => [remarkGfm, [remarkCitations, { paths }]], [paths])
  return (
    <div className="coja-markdown">
      <Markdown remarkPlugins={plugins} urlTransform={urlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
