/**
 * Pointer helpers for the `@pierre/trees` file tree.
 *
 * The tree renders inside an open shadow root and only reports a selection
 * through `onSelectionChange` after its own row `click` handler has run. A
 * press also moves DOM focus into the tree, and the tree reacts to that focus
 * change (controller focus, re-render, focused-row scroll pass) between
 * `mousedown` and `mouseup`, so the very first click on a row can be lost:
 * the row shows its focus ring but nothing is selected. Opening a file on
 * `pointerdown` instead does not depend on the click being delivered; every
 * row carries `data-item-path` / `data-item-type`, and `composedPath()` still
 * lists shadow nodes for a listener on the host.
 */

/** The file path of the row a pointer event started on, or null for anything else (directories included). */
export function fileRowPathFromComposedPath(path: readonly EventTarget[]): string | null {
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue
    const { type, itemType, itemPath } = node.dataset
    if (type !== 'item' || itemPath === undefined) continue
    return itemType === 'file' ? itemPath : null
  }
  return null
}

export interface PressLike {
  button: number
  pointerType?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * A plain primary-button mouse/pen press. Modifier presses are the tree's
 * multi-select gestures and touch presses may be the start of a scroll, so
 * both are left to the tree's own click handling.
 */
export function isPlainPrimaryPress(press: PressLike): boolean {
  if (press.button !== 0 || press.pointerType === 'touch') return false
  return !(press.ctrlKey || press.metaKey || press.shiftKey || press.altKey)
}
