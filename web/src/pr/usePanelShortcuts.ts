import { useEffect } from 'react'

interface PanelShortcuts {
  onToggleTree(): void
  onToggleAi(): void
}

/**
 * VS Code muscle memory for the review screen's panels: Cmd/Ctrl+B toggles
 * the file tree, Cmd/Ctrl+Shift+B the AI panel. The listener is global to the
 * screen, so it works while the diff, the tree or the composer has focus.
 */
export function usePanelShortcuts({ onToggleTree, onToggleAi }: PanelShortcuts): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b') return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      event.preventDefault()
      if (event.shiftKey) onToggleAi()
      else onToggleTree()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggleTree, onToggleAi])
}
