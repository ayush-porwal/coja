import { z } from 'zod'

/** Code sizing preferences persist per browser, independently of the theme. */
export interface TypographyPrefs {
  codeSize: number
  /** Unitless line-height multiplier. */
  codeLineHeight: number
}

export const TYPOGRAPHY_DEFAULTS: TypographyPrefs = {
  codeSize: 12.5,
  codeLineHeight: 1.5,
}

export const TYPOGRAPHY_LIMITS = {
  codeSize: { min: 10, max: 18, step: 0.5 },
  codeLineHeight: { min: 1.2, max: 2, step: 0.1 },
} as const

export const TYPOGRAPHY_STORAGE_KEY = 'coja.typography'

const prefsSchema = z.object({
  codeSize: z.number().min(TYPOGRAPHY_LIMITS.codeSize.min).max(TYPOGRAPHY_LIMITS.codeSize.max),
  codeLineHeight: z
    .number()
    .min(TYPOGRAPHY_LIMITS.codeLineHeight.min)
    .max(TYPOGRAPHY_LIMITS.codeLineHeight.max),
})

export function isTypographyPrefs(value: unknown): value is TypographyPrefs {
  return prefsSchema.safeParse(value).success
}

export function readTypographyPrefs(): TypographyPrefs {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)
    if (raw) {
      // Parsing strips retired font, UI size, and ligature preferences while
      // preserving the user's code sizing from older versions.
      const parsed = prefsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    }
  } catch {
    // Unreadable storage: defaults.
  }
  return { ...TYPOGRAPHY_DEFAULTS }
}

export function writeTypographyPrefs(prefs: TypographyPrefs): void {
  try {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Unwritable storage: session-only.
  }
}

export function typographyCssVariables(prefs: TypographyPrefs): Record<string, string> {
  return {
    '--coja-ui-font': '"IBM Plex Sans", system-ui, sans-serif',
    '--coja-code-font': '"Maple Mono NF", ui-monospace, SFMono-Regular, Menlo, monospace',
    '--coja-ui-size': '16px',
    '--coja-code-size': `${prefs.codeSize}px`,
    '--coja-code-line-height': String(prefs.codeLineHeight),
    '--coja-code-ligatures': 'normal',
  }
}

export function applyTypography(prefs: TypographyPrefs): void {
  if (typeof document === 'undefined') return
  for (const [name, value] of Object.entries(typographyCssVariables(prefs))) {
    document.documentElement.style.setProperty(name, value)
  }
}
