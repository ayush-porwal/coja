/** Joins class names, dropping falsy entries. Small on purpose; no dependency. */
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Visible focus ring shared by every interactive element. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** Inline text link. */
export const linkClass = cn('rounded-sm text-accent-text hover:underline', focusRing)
