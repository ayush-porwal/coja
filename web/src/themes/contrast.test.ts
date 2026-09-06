import { describe, expect, it } from 'vitest'
import { themeToCssProperties } from './apply'
import { type CojaPalette, PALETTES, type ThemeAppearance } from './palettes'

/**
 * Contrast validation for the diff surfaces, per palette AND appearance — the
 * guarantee that no theme ships with unreadable or invisible diff rows.
 *
 * The fills are computed exactly as the browser resolves them: the t3code
 * formulas in apply.ts are `color-mix(in srgb, <code> N%, <ok/danger>)`, so
 * here the sRGB mix is resolved per the CSS Color 5 spec (gamma-encoded sRGB
 * components) and the WCAG relative-contrast ratio is computed from the
 * linearised result.
 */

type Rgb = readonly [number, number, number]

/** `oklch(L C H)` — the only format the palette registry uses. */
function parseOklch(color: string): { L: number; C: number; H: number } {
  const match = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(color.trim())
  if (!match) throw new Error(`not an oklch() color: ${color}`)
  return { L: Number(match[1]), C: Number(match[2]), H: Number(match[3]) }
}

/** oklch → gamma-encoded sRGB, per CSS Color 4 (OKLab → linear sRGB → encode). */
function oklchToSrgb(color: string): Rgb {
  const { L, C, H } = parseOklch(color)
  const rad = (H * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l = L + 0.3963377774 * a + 0.2158037573 * b
  const m = L - 0.1055613458 * a - 0.0638541728 * b
  const s = L - 0.0894841775 * a - 1.291485548 * b
  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s
  const encode = (c: number) => {
    const clamped = Math.min(1, Math.max(0, c))
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  }
  return [
    encode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    encode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    encode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ]
}

/** `color-mix(in srgb, bg N%, color)` — N weights the *background* (CSS spec). */
function mixSrgb(bg: Rgb, color: Rgb, percentBg: number): Rgb {
  const w = percentBg / 100
  return [
    bg[0] * w + color[0] * (1 - w),
    bg[1] * w + color[1] * (1 - w),
    bg[2] * w + color[2] * (1 - w),
  ]
}

/** WCAG relative luminance from gamma-encoded sRGB. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Resolve the palette's sRGB mixtures as well as its literal colors. */
function resolveColor(value: string): Rgb {
  const mix = /^color-mix\(in srgb, (oklch\([^)]+\)) (\d+)%, (oklch\([^)]+\))\)$/.exec(value)
  if (!mix?.[1] || !mix[3]) return oklchToSrgb(value)
  return mixSrgb(oklchToSrgb(mix[1]), oklchToSrgb(mix[3]), Number(mix[2]))
}

describe('chrome action contrast per theme', () => {
  for (const palette of PALETTES) {
    for (const appearance of ['light', 'dark'] as const) {
      it(`${palette.id} ${appearance}: links, selected labels and action buttons are readable`, () => {
        const v = palette[appearance]
        const css = themeToCssProperties(palette, appearance) as Record<string, string>
        const cssColor = (name: string): string => {
          const value = css[name]
          if (!value) throw new Error(`theme is missing ${name}`)
          return value
        }
        const text = resolveColor(cssColor('--coja-accent-text'))
        for (const surface of [
          'canvas',
          'card',
          'panel',
          'overlay',
          'active',
          'accentSoft',
        ] as const) {
          expect(
            contrast(text, oklchToSrgb(v[surface])),
            `accent text on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
        for (const role of ['ok', 'danger']) {
          expect(
            contrast(
              resolveColor(cssColor(`--coja-${role}-button`)),
              resolveColor(cssColor('--coja-status-button-ink')),
            ),
            role,
          ).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})

/** The changed-row fills, from apply.ts's t3code formulas. */
function fillsFor(palette: CojaPalette, appearance: ThemeAppearance) {
  const v = palette[appearance]
  const row = appearance === 'dark' ? 70 : 50
  return {
    addition: mixSrgb(oklchToSrgb(v.code), oklchToSrgb(v.ok), row),
    deletion: mixSrgb(oklchToSrgb(v.code), oklchToSrgb(v.danger), row),
  }
}

describe('diff contrast per theme', () => {
  for (const palette of PALETTES) {
    for (const appearance of ['light', 'dark'] as const) {
      it(`${palette.id} ${appearance}: diff text stays readable and fills stay visible`, () => {
        const v = palette[appearance]
        const code = oklchToSrgb(v.code)
        const ink = oklchToSrgb(v.codeInk)
        const { addition, deletion } = fillsFor(palette, appearance)

        // Sanity for the maths itself: ordinary code text on the code surface.
        expect(contrast(ink, code)).toBeGreaterThanOrEqual(7)

        // Diff text (12.5 px monospace = WCAG normal text) must survive sitting
        // on a filled band, in both hue families.
        const onAddition = contrast(ink, addition)
        const onDeletion = contrast(ink, deletion)
        expect(
          onAddition,
          `ink on addition fill = ${onAddition.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          onDeletion,
          `ink on deletion fill = ${onDeletion.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5)

        // The band itself must be clearly distinguishable from the code surface
        // (large-area visibility; GitHub's own bands land ≈1.1–1.4 here).
        const bandAddition = contrast(addition, code)
        const bandDeletion = contrast(deletion, code)
        expect(
          bandAddition,
          `addition band vs code = ${bandAddition.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(1.3)
        expect(
          bandDeletion,
          `deletion band vs code = ${bandDeletion.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(1.3)
      })
    }
  }

  it('keeps the bands clearly stronger than the subtle context-row shift', () => {
    // Band visibility is a lightness-distance question: the fills must move
    // much further from the code surface (in OKLab lightness) than the
    // near-invisible context rows do.
    const oklabL = ([r, g, b]: Rgb): number => {
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
      const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
      const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
      const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
      return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    }
    for (const palette of PALETTES) {
      for (const appearance of ['light', 'dark'] as const) {
        const v = palette[appearance]
        const codeL = parseOklch(v.code).L
        const contextL = oklabL(mixSrgb(oklchToSrgb(v.code), oklchToSrgb(v.codeInk), 97))
        const { addition, deletion } = fillsFor(palette, appearance)
        const additionShift = Math.abs(oklabL(addition) - codeL)
        const deletionShift = Math.abs(oklabL(deletion) - codeL)
        const contextShift = Math.abs(contextL - codeL)
        expect(
          additionShift,
          `${palette.id}/${appearance}: addition ΔL ${additionShift.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(0.06)
        expect(
          deletionShift,
          `${palette.id}/${appearance}: deletion ΔL ${deletionShift.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(0.06)
        expect(
          contextShift,
          `${palette.id}/${appearance}: context ΔL ${contextShift.toFixed(3)}`,
        ).toBeLessThanOrEqual(0.03)
      }
    }
  })
})
