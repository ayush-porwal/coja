/**
 * URL hygiene for model output. Assistant text is untrusted (prompt injection
 * through PR content is the threat model, design.md "Harness and security
 * model"): a link may only point at an http(s) origin, and nothing the model
 * writes is ever fetched by the page (Markdown.tsx renders images as text).
 */

/** `url` when it is an absolute http(s) URL; null for any other scheme, relative paths and junk. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const value = url.trim()
  if (!/^https?:\/\//i.test(value)) return null
  return URL.canParse(value) ? value : null
}
