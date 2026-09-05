import { useMemo } from 'react'
import Markdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { bridge } from '../bridge'
import { CITE_SCHEME, parseCitationUrl, remarkCitations } from './citations'
import { safeHttpUrl } from './urls'

type RemarkPlugins = NonNullable<Options['remarkPlugins']>
type Components = NonNullable<Options['components']>

/**
 * URL policy for model output, applied by react-markdown to `href` and `src`
 * alike: our `coja-cite:` links pass; otherwise only absolute http(s) URLs
 * survive (the default would also let mailto, irc, xmpp and relative URLs
 * through). A blanked URL renders as plain text below.
 */
function urlTransform(url: string): string {
  return url.startsWith(CITE_SCHEME) ? url : (safeHttpUrl(url) ?? '')
}

const citeClass =
  'inline cursor-pointer rounded-sm px-0.5 font-mono text-[0.9em] text-accent underline decoration-dotted hover:bg-accent-soft hover:decoration-solid'

const imageClass = 'rounded-sm bg-active px-1 font-mono text-[0.85em] text-muted'

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
    // urlTransform blanks everything but http(s); show those as plain text.
    if (!href) return <span {...rest}>{children}</span>
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="cursor-pointer" {...rest}>
        {children}
      </a>
    )
  },
  // Never an <img>: a markdown image is a request to a URL the model chose — an exfiltration
  // channel for anything it read with its tools. What was there is shown as inert text instead.
  img: ({ src, alt }) => {
    const url = typeof src === 'string' && src !== '' ? src : null
    return (
      <span className={imageClass} title="Images in AI answers are never loaded">
        [image{alt ? `: ${alt}` : ''}]
        {url && (
          <>
            {' '}
            <code className="break-all">{url}</code>
          </>
        )}
      </span>
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
