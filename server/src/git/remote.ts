/**
 * Recognise GitHub repositories in the URL forms git stores for remotes and in
 * the `owner/repo` shorthand users type. Anything that is not clearly a
 * github.com repository yields null; callers turn that into a 400.
 */

export interface GitHubRepo {
  owner: string
  repo: string
}

/** GitHub owner and repository names: alphanumerics, `-`, `_`, `.`; never `.` or `..`. */
const NAME = /^[A-Za-z0-9_.-]+$/

// scp-like syntax: [user@]github.com:owner/repo(.git)
const SCP_FORM = /^(?:[\w.-]+@)?github\.com:(.+)$/i
// URL syntax: [scheme://][user@]github.com[:port]/owner/repo(.git)(/)
const URL_FORM =
  /^(?:(?:ssh|https?|git|git\+ssh|ssh\+git):\/\/)?(?:[^@/\s]+@)?(?:www\.)?github\.com(?::\d+)?\/(.+)$/i

/**
 * Parse a remote URL into `{ owner, repo }` when it points at github.com.
 *
 * Accepts `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`,
 * `https://github.com/o/r(.git)(/)`, `git://github.com/o/r` and the bare
 * `github.com/o/r`. Returns null for anything else.
 */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  const input = url.trim()
  const scp = SCP_FORM.exec(input)
  const rest = scp?.[1] ?? URL_FORM.exec(input)?.[1]
  return rest === undefined ? null : splitOwnerRepo(rest)
}

/**
 * Parse what a user types to add a project by clone: `owner/repo`, or any URL
 * form {@link parseGitHubRemote} accepts.
 */
export function parseRepoSlug(input: string): GitHubRepo | null {
  const slug = input.trim()
  if (/^[^/:@\s]+\/[^/:@\s]+$/.test(slug)) return splitOwnerRepo(slug)
  return parseGitHubRemote(slug)
}

function splitOwnerRepo(rest: string): GitHubRepo | null {
  let p = rest.replace(/\/+$/, '')
  if (p.toLowerCase().endsWith('.git')) p = p.slice(0, -'.git'.length)
  const parts = p.split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!owner || !repo || !isName(owner) || !isName(repo)) return null
  return { owner, repo }
}

const isName = (s: string): boolean => NAME.test(s) && s !== '.' && s !== '..'
