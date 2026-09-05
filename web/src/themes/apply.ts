import type { CSSProperties } from 'react'
import type { CojaPalette, ThemeAppearance } from './palettes'

/**
 * Paints one palette + appearance onto the document: chrome variables
 * (`--coja-*`), the diff token variables the CSS-variable Shiki themes emit
 * (`--diffs-*`), and the diffs surface-tint overrides — all on `:root`, so
 * light-DOM chrome and the Pierre shadow trees restyle from one place.
 */

/** `--coja-*` custom properties, one per ThemeVariant key. */
const CHROME_VARIABLES: Record<keyof CojaPalette['light'], string> = {
  canvas: '--coja-canvas',
  chrome: '--coja-chrome',
  card: '--coja-card',
  overlay: '--coja-overlay',
  panel: '--coja-panel',
  panelEdge: '--coja-panel-edge',
  hover: '--coja-hover',
  active: '--coja-active',
  hoverAlt: '--coja-hover-alt',
  ink: '--coja-ink',
  muted: '--coja-muted',
  faint: '--coja-faint',
  edge: '--coja-edge',
  edgeStrong: '--coja-edge-strong',
  focus: '--coja-focus',
  accent: '--coja-accent',
  accentInk: '--coja-accent-ink',
  accentSoft: '--coja-accent-soft',
  ok: '--coja-ok',
  okSoft: '--coja-ok-soft',
  danger: '--coja-danger',
  dangerSoft: '--coja-danger-soft',
  caution: '--coja-caution',
  cautionSoft: '--coja-caution-soft',
  code: '--coja-code',
  codeInk: '--coja-code-ink',
}

/** The variables a styled element list can read inline (React `style` prop shape). */
export function themeToCssProperties(
  palette: CojaPalette,
  appearance: ThemeAppearance,
): CSSProperties {
  const styles: Record<string, string> = {}
  const variant = palette[appearance]
  for (const [key, variable] of Object.entries(CHROME_VARIABLES) as [string, string][]) {
    styles[variable] = variant[key as keyof CojaPalette['light']]
  }
  Object.assign(styles, diffVariables(palette, appearance))
  return styles as CSSProperties
}

/**
 * Diff-surface variables: the token colours the CSS-variable highlighter themes
 * reference, both backgrounds (the stylesheet picks per colour scheme), and the
 * row-tint overrides.
 *
 * The surface/tint recipes below are t3code's DIFF_SURFACE_THEME
 * (apps/web/src/lib/diffRendering.ts) copied verbatim: sRGB mixes against the
 * code surface and — for changed rows — against the full-strength ok/danger
 * colours. Their `light-dark(light, dark)` pairs are resolved per appearance
 * here, because applyTheme knows which appearance it is painting.
 */
function diffVariables(palette: CojaPalette, appearance: ThemeAppearance): Record<string, string> {
  const variant = palette[appearance]
  const tokens = palette.syntax[appearance]
  const code = variant.code
  const codeInk = variant.codeInk
  // sRGB mixing (not lab): it preserves the saturation that makes the changed
  // rows read as solid bands, exactly as in t3code's own diff panel.
  const mix = (bgPercent: number, color: string): string =>
    `color-mix(in srgb, ${code} ${bgPercent}%, ${color})`
  // Their per-appearance strengths: dark mixes further toward the colour.
  const row = appearance === 'dark' ? 70 : 50
  const number = appearance === 'dark' ? 60 : 35
  const emphasis = 80
  const hover = 85
  return {
    // Highlighter tokens (themes/diffTheme.ts emits `var(--diffs-token-…)`).
    '--diffs-background': code,
    '--diffs-foreground': codeInk,
    '--diffs-token-keyword': tokens.keyword,
    '--diffs-token-function': tokens.fn,
    '--diffs-token-string': tokens.string,
    '--diffs-token-string-expression': tokens.string,
    '--diffs-token-constant': tokens.constant,
    '--diffs-token-comment': tokens.comment,
    '--diffs-token-punctuation': tokens.punct,
    '--diffs-token-parameter': variant.caution,
    '--diffs-token-link': tokens.fn,
    '--diffs-token-inserted': variant.ok,
    '--diffs-token-deleted': variant.danger,
    '--diffs-token-changed': variant.caution,
    // Diff surface: both slots so `light-dark()` inside the shadow tree picks
    // the right one whichever appearance CodeView is told to render.
    '--diffs-light-bg': palette.light.code,
    '--diffs-dark-bg': palette.dark.code,
    // Unchanged-row surfaces (t3code's ratios against the code foreground).
    '--diffs-bg-context-override': mix(97, codeInk),
    '--diffs-bg-separator-override': mix(95, codeInk),
    '--diffs-bg-buffer-override': mix(90, codeInk),
    '--diffs-bg-hover-override': mix(94, codeInk),
    '--diffs-bg-selection-override': mix(82, variant.accent),
    '--diffs-bg-selection-number-override': mix(70, variant.accent),
    // Changed rows (t3code's formulas verbatim).
    '--diffs-bg-addition-override': mix(row, variant.ok),
    '--diffs-bg-addition-number-override': mix(number, variant.ok),
    '--diffs-bg-addition-emphasis-override': mix(emphasis, variant.ok),
    '--diffs-bg-addition-hover-override': mix(hover, variant.ok),
    '--diffs-fg-number-addition-override': variant.ok,
    '--diffs-bg-deletion-override': mix(row, variant.danger),
    '--diffs-bg-deletion-number-override': mix(number, variant.danger),
    '--diffs-bg-deletion-emphasis-override': mix(emphasis, variant.danger),
    '--diffs-bg-deletion-hover-override': mix(hover, variant.danger),
    '--diffs-fg-number-deletion-override': variant.danger,
    '--diffs-addition-color-override': variant.ok,
    '--diffs-deletion-color-override': variant.danger,
    '--diffs-modified-color-override': variant.caution,
    '--diffs-fg-number-override': variant.muted,
  }
}

/** Applies the palette to `document.documentElement` and returns nothing. */
export function applyTheme(palette: CojaPalette, appearance: ThemeAppearance): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.cojaTheme = palette.id
  root.dataset.cojaAppearance = appearance
  root.style.colorScheme = appearance
  const styles = themeToCssProperties(palette, appearance)
  for (const [variable, value] of Object.entries(styles)) {
    root.style.setProperty(variable, value)
  }
}
