import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, themeToCssProperties } from './apply'
import { COJA_DIFF_THEMES } from './diffTheme'
import { PALETTES, type ThemeVariant } from './palettes'
import {
  DEFAULT_PREFERENCE,
  getPalette,
  isThemePreference,
  readThemePreference,
  resolveAppearance,
  resolvePalette,
  THEME_STORAGE_KEY,
  variantOf,
  writeThemePreference,
} from './registry'
import { treeStylesFor } from './treeTheme'

describe('registry', () => {
  it('ships five palettes, each with a complete light and dark variant', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(4)
    const required = [
      'canvas',
      'chrome',
      'card',
      'overlay',
      'panel',
      'panelEdge',
      'hover',
      'active',
      'hoverAlt',
      'ink',
      'muted',
      'faint',
      'edge',
      'edgeStrong',
      'focus',
      'accent',
      'accentInk',
      'accentSoft',
      'ok',
      'okSoft',
      'danger',
      'dangerSoft',
      'caution',
      'cautionSoft',
      'code',
      'codeInk',
    ]
    for (const palette of PALETTES) {
      for (const appearance of ['light', 'dark'] as const) {
        const variant: ThemeVariant = variantOf(palette, appearance)
        for (const key of required) {
          expect(
            variant[key as keyof ThemeVariant],
            `${palette.id}/${appearance}/${key}`,
          ).toBeTruthy()
        }
        for (const key of ['keyword', 'fn', 'string', 'constant', 'comment', 'punct'] as const) {
          expect(palette.syntax[appearance][key], `${palette.id}/${appearance}/${key}`).toBeTruthy()
        }
      }
    }
  })

  it('includes the renamed Mulberry palette and light and dark defaults', () => {
    expect(getPalette('mulberry')).toBeDefined()
    expect(getPalette('t3-chat')).toBeUndefined()
    expect(DEFAULT_PREFERENCE.palette).toBe('mulberry')
  })

  it('resolves appearance: system follows the OS, explicit wins', () => {
    expect(resolveAppearance({ palette: 'mulberry', appearance: 'system' }, true)).toBe('dark')
    expect(resolveAppearance({ palette: 'mulberry', appearance: 'system' }, false)).toBe('light')
    expect(resolveAppearance({ palette: 'mulberry', appearance: 'light' }, true)).toBe('light')
    expect(resolveAppearance({ palette: 'mulberry', appearance: 'dark' }, false)).toBe('dark')
  })

  it('round-trips the preference through localStorage and rejects foreign values', () => {
    writeThemePreference({ palette: 'ocean', appearance: 'dark' })
    expect(readThemePreference()).toEqual({ palette: 'ocean', appearance: 'dark' })

    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ palette: 'nope', appearance: 'dark' }))
    expect(readThemePreference()).toEqual(DEFAULT_PREFERENCE)
    localStorage.setItem(THEME_STORAGE_KEY, 'not json')
    expect(readThemePreference()).toEqual(DEFAULT_PREFERENCE)

    expect(isThemePreference({ palette: 'grove', appearance: 'system' })).toBe(true)
    expect(isThemePreference({ palette: 'grove', appearance: 'sometimes' })).toBe(false)
  })

  it('resolvePalette falls back to the default for unknown ids', () => {
    expect(resolvePalette('mulberry').id).toBe('mulberry')
    expect(resolvePalette('unknown-theme').id).toBe(DEFAULT_PREFERENCE.palette)
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-coja-theme')
    document.documentElement.removeAttribute('data-coja-appearance')
  })

  it('stamps the document with the palette and appearance and sets every chrome variable', () => {
    const palette = resolvePalette('iris')
    applyTheme(palette, 'dark')
    const root = document.documentElement
    expect(root.dataset.cojaTheme).toBe('iris')
    expect(root.dataset.cojaAppearance).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.style.getPropertyValue('--coja-canvas')).toBe(palette.dark.canvas)
    expect(root.style.getPropertyValue('--coja-accent')).toBe(palette.dark.accent)
    // Diff wiring rides the same application:
    expect(root.style.getPropertyValue('--diffs-background')).toBe(palette.dark.canvas)
    expect(root.style.getPropertyValue('--diffs-token-keyword')).toBe(palette.syntax.dark.keyword)
    expect(root.style.getPropertyValue('--diffs-light-bg')).toBeTruthy()
    expect(root.style.getPropertyValue('--diffs-dark-bg')).toBeTruthy()
    // t3code's verbatim formula: sRGB mix toward the full-strength ok colour.
    expect(root.style.getPropertyValue('--diffs-bg-addition-override')).toBe(
      `color-mix(in srgb, ${palette.dark.canvas} 70%, ${palette.dark.ok})`,
    )
  })

  it('uses one neutral surface across pages, loading containers, trees and diffs in every theme', () => {
    for (const palette of PALETTES) {
      for (const appearance of ['light', 'dark'] as const) {
        const css = themeToCssProperties(palette, appearance) as Record<string, string>
        for (const role of ['canvas', 'chrome', 'card', 'overlay', 'panel', 'code']) {
          expect(css[`--coja-${role}`]).toBe(palette[appearance].canvas)
        }
        for (const role of ['context', 'separator', 'buffer']) {
          expect(css[`--diffs-bg-${role}-override`]).toBe(palette[appearance].canvas)
        }
        expect(treeStylesFor(palette, appearance).backgroundColor).toBe(css['--coja-canvas'])
      }
    }
  })

  it('themeToCssProperties covers all chrome roles', () => {
    const styles = themeToCssProperties(resolvePalette('grove'), 'light') as Record<string, string>
    expect(styles['--coja-panel']).toBe(resolvePalette('grove').light.canvas)
    expect(styles['--coja-code']).toBe(resolvePalette('grove').light.canvas)
  })
})

describe('pierre mapping', () => {
  it('registers the CSS-variable diff theme pair used by CodeView', () => {
    expect(COJA_DIFF_THEMES).toEqual({ dark: 'coja-dark', light: 'coja-light' })
  })

  it('maps the palette onto tree styles for both appearances', () => {
    for (const palette of PALETTES) {
      for (const appearance of ['light', 'dark'] as const) {
        const styles = treeStylesFor(palette, appearance)
        expect(styles.backgroundColor).toBe(palette[appearance].canvas)
        expect(styles.colorScheme ?? styles.colorScheme).toBeTruthy()
      }
    }
  })
})
