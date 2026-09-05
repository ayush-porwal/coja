import type { CojaPalette, ThemeAppearance } from './palettes'

/**
 * A palette preview: three bands of the palette's own colours — canvas,
 * code surface with a token-coloured notch, accent. Used in the pickers; the
 * bands are the honest preview (this is what the chrome and the diff will
 * actually wear), not decoration.
 */
export function ThemeSwatch({
  palette,
  appearance,
  size = 'sm',
}: {
  palette: CojaPalette
  appearance: ThemeAppearance
  size?: 'sm' | 'md'
}) {
  const v = palette[appearance]
  const h = size === 'sm' ? 'h-5' : 'h-9'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${h} w-9 flex-col overflow-hidden rounded-sm border border-edge`}
    >
      <span className="h-1/2 w-full" style={{ background: v.canvas }} />
      <span className="relative h-1/2 w-full" style={{ background: v.code }}>
        <span
          className="absolute top-0 left-0 h-full w-1/3"
          style={{ background: v.accent, opacity: 0.85 }}
        />
      </span>
    </span>
  )
}
