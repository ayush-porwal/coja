import { z } from 'zod'

/**
 * Typography preferences: UI/code font families, sizes, code line height and
 * ligatures. Persisted per browser and independent of the color palette /
 * appearance — switching themes never resets these.
 */

export const UI_FONT_OPTIONS = [
  { value: 'plex', label: 'IBM Plex Sans', stack: '"IBM Plex Sans", system-ui, sans-serif' },
  { value: 'system', label: 'System sans', stack: 'system-ui, sans-serif' },
] as const

export const CODE_FONT_OPTIONS = [
  {
    value: 'maple',
    label: 'Maple Mono NF',
    stack: '"Maple Mono NF", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  {
    value: 'system',
    label: 'System mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
] as const

export type UiFontFamily = (typeof UI_FONT_OPTIONS)[number]['value']
export type CodeFontFamily = (typeof CODE_FONT_OPTIONS)[number]['value']

export interface TypographyPrefs {
  uiFont: UiFontFamily
  codeFont: CodeFontFamily
  /** UI base font size in px. */
  uiSize: number
  /** Diff/code font size in px. */
  codeSize: number
  /** Code line height (unitless multiplier). */
  codeLineHeight: number
  /** Programming ligatures in code fonts. */
  codeLigatures: boolean
}

export const TYPOGRAPHY_DEFAULTS: TypographyPrefs = {
  uiFont: 'plex',
  codeFont: 'maple',
  uiSize: 14,
  codeSize: 12.5,
  codeLineHeight: 1.5,
  codeLigatures: true,
}

/** Bounded ranges — useful values, and they keep the layout math sane. */
export const TYPOGRAPHY_LIMITS = {
  uiSize: { min: 12, max: 18, step: 1 },
  codeSize: { min: 10, max: 18, step: 0.5 },
  codeLineHeight: { min: 1.2, max: 2, step: 0.1 },
} as const

export const TYPOGRAPHY_STORAGE_KEY = 'coja.typography'

const prefsSchema = z.object({
  uiFont: z.enum(['plex', 'system']),
  codeFont: z.enum(['maple', 'system']),
  uiSize: z
    .number()
    .refine((v) => v >= TYPOGRAPHY_LIMITS.uiSize.min && v <= TYPOGRAPHY_LIMITS.uiSize.max),
  codeSize: z
    .number()
    .refine((v) => v >= TYPOGRAPHY_LIMITS.codeSize.min && v <= TYPOGRAPHY_LIMITS.codeSize.max),
  codeLineHeight: z
    .number()
    .refine(
      (v) => v >= TYPOGRAPHY_LIMITS.codeLineHeight.min && v <= TYPOGRAPHY_LIMITS.codeLineHeight.max,
    ),
  codeLigatures: z.boolean(),
})

export function isTypographyPrefs(value: unknown): value is TypographyPrefs {
  return prefsSchema.safeParse(value).success
}

export function readTypographyPrefs(): TypographyPrefs {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isTypographyPrefs(parsed)) return parsed
    }
  } catch {
    // unreadable storage: defaults
  }
  return { ...TYPOGRAPHY_DEFAULTS }
}

export function writeTypographyPrefs(prefs: TypographyPrefs): void {
  try {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // unwritable storage: session-only
  }
}

export function uiFontStack(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((o) => o.value === font)?.stack ?? TYPOGRAPHY_DEFAULTS.uiFont
}

export function codeFontStack(font: CodeFontFamily): string {
  return CODE_FONT_OPTIONS.find((o) => o.value === font)?.stack ?? TYPOGRAPHY_DEFAULTS.codeFont
}

/** CSS custom properties consumed by index.css + Pierre shadow styling. */
export function typographyCssVariables(prefs: TypographyPrefs): Record<string, string> {
  return {
    '--coja-ui-font': uiFontStack(prefs.uiFont),
    '--coja-code-font': codeFontStack(prefs.codeFont),
    '--coja-ui-size': `${prefs.uiSize}px`,
    '--coja-code-size': `${prefs.codeSize}px`,
    '--coja-code-line-height': String(prefs.codeLineHeight),
    '--coja-code-ligatures': prefs.codeLigatures ? 'normal' : 'none',
  }
}

/** The variable set this module manages, applied to <html> on change. */
export function applyTypography(prefs: TypographyPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const vars = typographyCssVariables(prefs)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
}
