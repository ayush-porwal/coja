import { type BrandAppearance, brandAssetsFor } from './manifest'

/** Sizes the static mark for its context (defaults keep the asset square). */
export interface BrandMarkProps {
  paletteId: string
  appearance: BrandAppearance
  /** Pixel size for width and height. */
  size?: number
  className?: string
}

/**
 * The static CJ product mark for the active palette + appearance, straight
 * from the approved SVG matrix. Decorative by default: name it with
 * `aria-label`/`role="img"` at call sites where it stands alone.
 */
export function BrandMark({ paletteId, appearance, size, className }: BrandMarkProps) {
  const { icon } = brandAssetsFor(paletteId, appearance)
  return (
    <img src={icon} alt="" width={size} height={size} className={className} draggable={false} />
  )
}
