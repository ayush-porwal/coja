import type { TreeThemeStyles } from '@pierre/trees'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useBrandFavicon } from '../brand/useBrandFavicon'
import { usePersistedState } from '../pr/usePersistedState'
import {
  applyTypography,
  readTypographyPrefs,
  TYPOGRAPHY_DEFAULTS,
  type TypographyPrefs,
  writeTypographyPrefs,
} from '../typography'
import { applyTheme } from './apply'
import type { CojaPalette } from './palettes'
import {
  DEFAULT_PREFERENCE,
  isThemePreference,
  resolveAppearance,
  resolvePalette,
  type ThemePreference,
} from './registry'
import { treeStylesFor } from './treeTheme'

interface ThemeContextValue {
  preference: ThemePreference
  setPreference(preference: ThemePreference): void
  /** The palette the preference resolves to (default when unknown — validated on read). */
  palette: CojaPalette
  /** The rendered appearance: preference, or the OS preference when 'system'. */
  appearance: 'light' | 'dark'
  /** `--trees-theme-*` styles for the FileTree host, from the active palette. */
  treeStyles: TreeThemeStyles
  /** User typography preferences (families, sizes, ligatures). */
  typography: TypographyPrefs
  setTypography(next: TypographyPrefs): void
  resetTypography(): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const isSystemDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * Owns the theme preference (persisted under the same `coja.theme` key the
 * boot path in `main.tsx` reads) and applies every change to the document.
 * While the preference is 'system' a `prefers-color-scheme` listener re-applies
 * on OS switches, so the default tracks the OS until the user picks.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = usePersistedState<ThemePreference>(
    'coja.theme',
    DEFAULT_PREFERENCE,
    isThemePreference,
  )
  const systemDark = useSystemDark()

  const palette = resolvePalette(preference.palette)
  const appearance = resolveAppearance(preference, systemDark)
  const [typography, setTypographyState] = useState<TypographyPrefs>(() => readTypographyPrefs())
  const setTypography = useCallback((next: TypographyPrefs) => {
    setTypographyState(next)
    writeTypographyPrefs(next)
    applyTypography(next)
  }, [])
  const resetTypography = useCallback(() => {
    setTypography({ ...TYPOGRAPHY_DEFAULTS })
  }, [setTypography])
  const treeStyles = useMemo(() => treeStylesFor(palette, appearance), [palette, appearance])

  useEffect(() => {
    applyTheme(palette, appearance)
  }, [palette, appearance])

  // Brand assets (favicon, marks, loaders) switch with palette + appearance.
  useBrandFavicon(palette.id, appearance)

  // Apply persisted typography on mount; changes apply through setTypography.
  useEffect(() => {
    applyTypography(typography)
  }, [typography])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference,
      palette,
      appearance,
      treeStyles,
      typography,
      setTypography,
      resetTypography,
    }),
    [
      preference,
      setPreference,
      palette,
      appearance,
      treeStyles,
      typography,
      setTypography,
      resetTypography,
    ],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState(isSystemDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (value) return value
  // Outside the provider (unit tests mount components directly): the boot path
  // in main.tsx has already applied the stored theme to the document, so
  // reading the default preference is safe; only live changes need the provider.
  const palette = resolvePalette(DEFAULT_PREFERENCE.palette)
  const appearance = isSystemDark() ? 'dark' : 'light'
  return {
    preference: DEFAULT_PREFERENCE,
    setPreference: () => {},
    palette,
    appearance,
    typography: readTypographyPrefs(),
    setTypography: () => {},
    resetTypography: () => {},
    treeStyles: treeStylesFor(palette, appearance),
  }
}
