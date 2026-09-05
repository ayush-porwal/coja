import { useEffect } from 'react'
import { type BrandAppearance, brandAssetsFor } from './manifest'

/**
 * Keeps the browser-tab favicon on the active palette + appearance. Idempotent:
 * reuses a single <link rel="icon"> element and only swaps its href.
 */
export function useBrandFavicon(paletteId: string, appearance: BrandAppearance): void {
  useEffect(() => {
    const href = brandAssetsFor(paletteId, appearance).icon
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-coja-brand]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/svg+xml'
      link.dataset.cojaBrand = ''
      document.head.appendChild(link)
    }
    if (link.href !== href) link.href = href
  }, [paletteId, appearance])
}
