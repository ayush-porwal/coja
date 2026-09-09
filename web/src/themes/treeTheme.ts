import type { TreeThemeStyles } from '@pierre/trees'
import { themeToTreeStyles } from '@pierre/trees'
import type { CojaPalette, ThemeAppearance } from './palettes'

/**
 * Maps a coja palette onto the `@pierre/trees` FileTree: a small VS
 * Code-workbench-style colour object per palette + appearance, run through
 * trees' own `themeToTreeStyles` (the same mapping idea t3code's
 * pierre-tree-theme.ts uses — palette tokens onto Pierre components, not
 * Pierre-specific colours in the app).
 */
export function treeStylesFor(palette: CojaPalette, appearance: ThemeAppearance): TreeThemeStyles {
  const v = palette[appearance]
  return themeToTreeStyles({
    type: appearance,
    colors: {
      'sideBar.background': v.canvas,
      'sideBar.foreground': v.ink,
      'sideBarSectionHeader.foreground': v.muted,
      'sideBar.border': v.panelEdge,
      'list.hoverBackground': v.hover,
      'list.activeSelectionBackground': v.active,
      'list.focusBackground': v.hover,
      'list.activeSelectionForeground': v.ink,
      'list.focusOutline': v.accent,
      'input.background': v.canvas,
      'input.border': v.edgeStrong,
      'scrollbarSlider.background': v.edge,
      'gitDecoration.addedResourceForeground': v.ok,
      'gitDecoration.modifiedResourceForeground': v.caution,
      'gitDecoration.deletedResourceForeground': v.danger,
    },
  })
}
