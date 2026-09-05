import { type CojaPalette, PALETTES, type ThemeAppearance } from './palettes'

/** Which palette to wear and which appearance to render it in. */
export interface ThemePreference {
  palette: string
  appearance: 'system' | ThemeAppearance
}

export const THEME_STORAGE_KEY = 'coja.theme'

/** The palette coja wears before the user ever picks one; appearance follows the OS. */
export const DEFAULT_PREFERENCE: ThemePreference = { palette: 'mulberry', appearance: 'system' }

export function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === 'light' || value === 'dark'
}

export function isThemePreference(value: unknown): value is ThemePreference {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.palette === 'string' &&
    getPalette(candidate.palette) !== undefined &&
    (candidate.appearance === 'system' || isThemeAppearance(candidate.appearance))
  )
}

export function getPalette(id: string): CojaPalette | undefined {
  return PALETTES.find((palette) => palette.id === id)
}

/** `getPalette` for ids that must resolve (the default palette always exists). */
export function resolvePalette(id: string): CojaPalette {
  const palette = getPalette(id) ?? getPalette(DEFAULT_PREFERENCE.palette)
  if (!palette)
    throw new Error(`coja: unknown theme "${id}" and no default palette in the registry`)
  return palette
}

/**
 * Reads the stored preference. A stale or foreign value (unknown palette id —
 * the registry is code, not data) falls back to the default. Storage failures
 * are ignored, mirroring `usePersistedState`.
 */
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (isThemePreference(parsed)) return parsed
    }
  } catch {
    // unreadable storage: use the default
  }
  return DEFAULT_PREFERENCE
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // unwritable storage: the choice still works for this session
  }
}

export function resolveAppearance(
  preference: ThemePreference,
  systemDark: boolean,
): ThemeAppearance {
  if (preference.appearance === 'system') return systemDark ? 'dark' : 'light'
  return preference.appearance
}

/** The variant of `palette` rendered in `appearance`; every palette has both. */
export function variantOf(
  palette: CojaPalette,
  appearance: ThemeAppearance,
): CojaPalette[typeof appearance] {
  return palette[appearance]
}
