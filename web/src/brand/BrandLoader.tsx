import type { AnimationItem } from 'lottie-web'
import { useEffect, useRef, useState } from 'react'
import type { BrandLoaderSize } from './manifest'
import { type BrandAppearance, brandAssetsFor, brandManifest } from './manifest'

export const BRAND_LOADER_SIZES = brandManifest.sizes
/** Frame of the completed mark for consumers that need a still animation. */
export const BRAND_COMPLETED_FRAME = 260

interface BrandLoaderProps {
  paletteId: string
  appearance: BrandAppearance
  size: BrandLoaderSize
  pixelSize?: number
  label?: string
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

/** Theme-specific handwriting, with a real SVG still until ready or on failure. */
export function BrandLoader({
  paletteId,
  appearance,
  size,
  pixelSize,
  label,
  speed = 1,
  className,
}: BrandLoaderProps) {
  const { icon, loaders } = brandAssetsFor(paletteId, appearance)
  const src = loaders[size]
  const reduced = usePrefersReducedMotion()
  const px = pixelSize ?? BRAND_LOADER_SIZES[size]
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<AnimationItem | null>(null)
  const frameRef = useRef(0)
  const speedRef = useRef(speed)
  const [readySrc, setReadySrc] = useState<string | null>(null)

  useEffect(() => {
    speedRef.current = speed
    playerRef.current?.setSpeed(speed)
  }, [speed])

  useEffect(() => {
    if (reduced) return
    const container = containerRef.current
    if (!container) return
    const abort = new AbortController()
    let disposed = false
    let instance: AnimationItem | null = null
    setReadySrc(null)

    const fail = () => {
      if (disposed) return
      setReadySrc(null)
      if (playerRef.current === instance) playerRef.current = null
      instance?.destroy()
      instance = null
    }
    Promise.all([
      import('lottie-web').then((m) => m.default),
      fetch(src, { signal: abort.signal }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      }),
    ])
      .then(([lottie, animationData]) => {
        if (disposed) return
        instance = lottie.loadAnimation({
          container,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData: structuredClone(animationData),
        })
        playerRef.current = instance
        instance.setSpeed(speedRef.current)
        const ready = () => {
          if (disposed || !instance) return
          instance.goToAndPlay(frameRef.current, true)
          setReadySrc(src)
        }
        instance.addEventListener('DOMLoaded', ready)
        instance.addEventListener('data_failed', fail)
        instance.addEventListener('error', fail)
        if (instance.isLoaded) ready()
      })
      .catch(fail)

    return () => {
      disposed = true
      abort.abort()
      if (instance) {
        frameRef.current = instance.currentFrame
        instance.destroy()
      }
      if (playerRef.current === instance) playerRef.current = null
      container.replaceChildren()
    }
  }, [src, reduced])

  const animated = !reduced && readySrc === src
  return (
    <div className={`flex max-w-full flex-col items-center gap-3 ${className ?? ''}`}>
      <div
        aria-hidden="true"
        className="relative aspect-square max-w-full shrink-0"
        style={{ width: px }}
      >
        <img
          src={icon}
          alt=""
          width={px}
          height={px}
          draggable={false}
          className="h-full w-full object-contain p-[5.882353%]"
          style={{ visibility: animated ? 'hidden' : 'visible' }}
        />
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ visibility: animated ? 'visible' : 'hidden' }}
        />
      </div>
      <p role="status" className={label ? 'text-center text-sm text-muted' : 'sr-only'}>
        {label ?? 'Loading…'}
      </p>
    </div>
  )
}
