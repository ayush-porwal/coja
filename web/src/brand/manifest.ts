/**
 * Access to the approved CJ brand asset matrix (web/public/brand/coja/).
 * Selection is by palette id + resolved appearance; assets already contain
 * that theme's ink/accent colors, so nothing here recolors them.
 */

export type BrandLoaderSize = 'huge' | 'large' | 'medium' | 'small'
export type BrandAppearance = 'light' | 'dark'

export interface BrandThemeAssets {
  ink: string
  accent: string
  icon: string
  loaders: Record<BrandLoaderSize, string>
}

export interface BrandManifest {
  version: number
  defaultPalette: string
  sizes: Record<BrandLoaderSize, number>
  themes: Record<string, Record<BrandAppearance, BrandThemeAssets>>
}

import defaultManifest from '../../public/brand/coja/manifest.json'

export const brandManifest: BrandManifest = defaultManifest

/**
 * Assets for a palette + appearance. Unknown palettes fall back to the
 * manifest's default palette with the same appearance (system is resolved by
 * the caller through the theme registry — there is no "system" directory).
 */
export function brandAssetsFor(paletteId: string, appearance: BrandAppearance): BrandThemeAssets {
  const themes = brandManifest.themes
  const theme = themes[paletteId] ?? themes[brandManifest.defaultPalette]
  if (!theme) throw new Error('brand manifest is missing its default palette')
  return theme[appearance] ?? theme.light
}
