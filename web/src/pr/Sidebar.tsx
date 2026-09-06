import type { ChangedFile, ReviewThread } from '@coja/shared/api'
import type { FileTreeRowDecoration, GitStatusEntry } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '../themes/ThemeContext'
import { changeTypeToGitStatus } from './mapping'
import { fileRowPathFromComposedPath, isPlainPrimaryPress } from './treeRow'
import type { CenterSelection } from './types'

interface SidebarProps {
  files: ChangedFile[]
  threads: ReviewThread[]
  conversationCount: number
  selection: CenterSelection
  onSelectOverview(): void
  onSelectFile(path: string): void
}

/** Review threads per file path (the tree's comment-count badge). */
export function threadCountsByPath(threads: readonly ReviewThread[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const thread of threads) counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1)
  return counts
}

function toGitStatus(files: readonly ChangedFile[]): GitStatusEntry[] {
  return files.map((f) => ({ path: f.path, status: changeTypeToGitStatus(f.changeType) }))
}

/**
 * Left column: the Overview entry plus the changed-files tree (`@pierre/trees`).
 * `useFileTree` reads its options exactly once, so everything dynamic goes
 * through refs (callbacks) or model methods (paths, git status, repaint).
 *
 * A file opens on `pointerdown` (see `treeRow.ts`): the tree's own click
 * handling can miss the first press that also moves focus into the tree, and
 * the press is the user's intent anyway. `onSelectionChange` still covers the
 * keyboard and the tree's click, deduplicated against the current selection.
 */
export function Sidebar({
  files,
  threads,
  conversationCount,
  selection,
  onSelectOverview,
  onSelectFile,
}: SidebarProps) {
  const { treeStyles } = useTheme()
  const counts = useMemo(() => threadCountsByPath(threads), [threads])
  const viewed = useMemo(
    () => new Set(files.filter((f) => f.viewedState === 'VIEWED').map((f) => f.path)),
    [files],
  )
  const selectedPath = selection.kind === 'file' ? selection.path : null

  const latest = useRef({ files, counts, viewed, selectedPath, onSelectFile })
  latest.current = { files, counts, viewed, selectedPath, onSelectFile }

  const { model } = useFileTree({
    paths: files.map((f) => f.path),
    gitStatus: toGitStatus(files),
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    density: 'compact',
    // The tree's own scrollbar thumb is transparent until the tree is hovered —
    // so even on systems that paint overlay thumbs persistently, a tall file
    // tree gives no clue of its depth. Force the thumb to the app's thin
    // quarter-strength ink at all times (the scroller already carries
    // `scrollbar-width: thin` and a stable gutter).
    unsafeCSS: `
      [data-file-tree-virtualized-scroll="true"] {
        --trees-scrollbar-thumb-current: color-mix(in srgb, var(--coja-ink, #888) 35%, transparent);
      }
    `,
    onSelectionChange: (paths) => {
      const path = paths[0]
      // Directory rows also fire selection changes; only files open a diff.
      if (!path || path.endsWith('/')) return
      if (!latest.current.files.some((f) => f.path === path)) return
      if (path === latest.current.selectedPath) return
      latest.current.onSelectFile(path)
    },
    renderRowDecoration: ({ item }): FileTreeRowDecoration | null => {
      if (item.kind !== 'file') return null
      const n = latest.current.counts.get(item.path) ?? 0
      const seen = latest.current.viewed.has(item.path)
      if (!n && !seen) return null
      const parts: { text: string; color?: string }[] = []
      if (n) parts.push({ text: `${n}` })
      if (seen) parts.push({ text: n ? ' ✓' : '✓', color: 'var(--coja-ok, #16a34a)' })
      const title = [n ? `${n} ${n === 1 ? 'thread' : 'threads'}` : '', seen ? 'viewed' : '']
        .filter(Boolean)
        .join(' · ')
      return { text: parts.map((p) => p.text).join(''), parts, title }
    },
  })

  // Keep the model in sync with the PR (the file list can change after a refetch).
  const pathsSignature = files.map((f) => f.path).join('\n')
  const appliedPaths = useRef(pathsSignature)
  useEffect(() => {
    if (appliedPaths.current === pathsSignature) return
    appliedPaths.current = pathsSignature
    model.resetPaths(pathsSignature.split('\n').filter(Boolean))
  }, [model, pathsSignature])

  const statusSignature = files.map((f) => `${f.path}:${f.changeType}`).join('\n')
  const appliedStatus = useRef(statusSignature)
  useEffect(() => {
    if (appliedStatus.current === statusSignature) return
    appliedStatus.current = statusSignature
    model.setGitStatus(toGitStatus(latest.current.files))
  }, [model, statusSignature])

  // Row decorations are only re-evaluated when the tree repaints; force one when their inputs change.
  const decorationSignature = `${[...counts].map(([p, n]) => `${p}=${n}`).join('\n')}|${[...viewed].join('\n')}`
  const paintedDecorations = useRef('')
  useEffect(() => {
    if (paintedDecorations.current === decorationSignature) return
    paintedDecorations.current = decorationSignature
    model.setComposition(model.getComposition())
  }, [model, decorationSignature])

  // Mirror the center selection into the tree (citations and Overview change it from outside).
  useEffect(() => {
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedPath) model.getItem(path)?.deselect()
    }
    if (selectedPath === null) return
    const item = model.getItem(selectedPath)
    if (item && !item.isSelected()) {
      item.select()
      model.scrollToPath(selectedPath, { offset: 'nearest' })
    }
  }, [model, selectedPath])

  const openFileFromPress = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isPlainPrimaryPress(event)) return
    const path = fileRowPathFromComposedPath(event.nativeEvent.composedPath())
    if (path === null || path === selectedPath) return
    if (!files.some((f) => f.path === path)) return
    onSelectFile(path)
  }

  const isOverview = selection.kind === 'overview'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onSelectOverview}
        aria-current={isOverview ? 'page' : undefined}
        className={`flex items-center justify-between gap-2 border-edge border-b px-3 py-2 text-left font-medium text-sm border-edge ${
          isOverview ? 'bg-accent-soft text-accent-text' : 'text-ink hover:bg-hover'
        }`}
      >
        <span>Overview</span>
        <span
          className="rounded-full bg-active px-1.5 text-[11px] leading-4 text-muted"
          title="Conversation items"
        >
          {conversationCount}
        </span>
      </button>
      <div className="flex items-center justify-between px-3 py-1.5 font-medium text-[11px] text-muted">
        <span>Files ({files.length})</span>
        <span title="Viewed files">
          {viewed.size}/{files.length} viewed
        </span>
      </div>
      <FileTree
        model={model}
        aria-label="Changed files"
        className="block min-h-0 flex-1 text-[12.5px]"
        style={treeStyles}
        onPointerDown={openFileFromPress}
      />
    </div>
  )
}
