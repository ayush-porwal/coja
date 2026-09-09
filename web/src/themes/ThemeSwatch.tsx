import type { CojaPalette, ThemeAppearance } from './palettes'

/** A compact preview of the shared canvas with the palette's accent. */
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
      <span className="relative h-1/2 w-full" style={{ background: v.canvas }}>
        <span
          className="absolute top-0 left-0 h-full w-1/3"
          style={{ background: v.accent, opacity: 0.85 }}
        />
      </span>
    </span>
  )
}
