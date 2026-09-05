import { useEffect, useRef, useState } from 'react'
import type { BrandLoaderSize } from './manifest'
import { type BrandAppearance, brandAssetsFor, brandManifest } from './manifest'

export const BRAND_LOADER_SIZES: Record<BrandLoaderSize, number> = brandManifest.sizes as Record<
  BrandLoaderSize,
  number
>

/** Frame of the completed mark used for reduced-motion and load fallbacks. */
export const BRAND_COMPLETED_FRAME = 260

interface BrandLoaderProps {
  paletteId: string
  appearance: BrandAppearance
  size: BrandLoaderSize
  /** Override the asset's nominal pixel size (responsive layouts). */
  pixelSize?: number
  /** Visible status text; also announced via a polite live region. */
  label?: string
  /** Playback rate (lottie `setSpeed`). >1 finishes the handwriting sooner. */
  speed?: number
  className?: string
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Static completed mark (frame 260), used for reduced motion and load failure. */
function StaticMark({ src, pixelSize, label }: { src: string; pixelSize: number; label?: string }) {
  return (
    <div
      className={label ? 'flex flex-col items-center gap-3' : 'flex items-center justify-center'}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <img src={src} alt="" width={pixelSize} height={pixelSize} draggable={false} />
      {label && (
        <p role="status" className="text-sm text-muted">
          {label}
        </p>
      )}
    </div>
  )
}

/**
 * The handwritten CJ loader for the active palette + appearance. Renders the
 * approved Lottie (C, hanging J, dot, hold, fade — looping) via lottie-web's
 * SVG renderer; falls back to the completed static mark for reduced motion or
 * if the animation fails to load, so loading UI never goes blank. The
 * animation is decorative: only `label` is announced.
 */
export function BrandLoader({
  paletteId,
  appearance,
  size,
  pixelSize,
  label,
  speed = 1,
  className,
}: BrandLoaderProps) {
  const { loaders } = brandAssetsFor(paletteId, appearance)
  const src = loaders[size]
  const reduced = usePrefersReducedMotion()
  const nominal = BRAND_LOADER_SIZES[size]
  const px = pixelSize ?? nominal
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const failedRef = useRef(false)

  const animationSrc = reduced ? null : src
  const staticSrc = loaders[size] // same file: frame 260 of it, no extra asset

  // Lottie lifecycle: destroy on src change/unmount; Strict Mode-safe because
  // cleanup destroys before the (re)run creates a fresh player.
  useEffect(() => {
    if (!animationSrc || failedRef.current) return
    let destroyed = false
    let instance: { destroy: () => void; setSpeed: (rate: number) => void } | null = null
    let cancelled = false

    Promise.all([
      import('lottie-web').then((m) => m.default),
      fetch(animationSrc).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
    ])
      .then(([lottie, animationData]) => {
        if (destroyed || cancelled || !containerRef.current) return
        instance = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: structuredClone(animationData),
        })
        if (speed !== 1) instance.setSpeed(speed)
      })
      .catch(() => {
        if (!destroyed) {
          failedRef.current = true
          setFailed(true)
        }
      })

    return () => {
      destroyed = true
      cancelled = true
      instance?.destroy()
      instance = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [animationSrc, speed])

  if (reduced || failed) {
    return <StaticMark src={staticSrc} pixelSize={px} label={label} />
  }

  return (
    <div className={label ? 'flex flex-col items-center gap-3' : 'flex flex-col items-center'}>
      <div
        ref={containerRef}
        role="img"
        aria-label={label ?? 'Loading'}
        style={{ width: px, height: px }}
        className={className}
      />
      {label && (
        <p role="status" className="text-sm text-muted">
          {label}
        </p>
      )}
    </div>
  )
}
