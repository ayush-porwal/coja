import type { ChangedFile, ReviewThread } from '@coja/shared/api'
import type { FileTreeRowDecoration, GitStatusEntry } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useRef } from 'react'
import { changeTypeToGitStatus } from './mapping'
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
 */
export function Sidebar({
  files,
  threads,
  conversationCount,
  selection,
  onSelectOverview,
  onSelectFile,
}: SidebarProps) {
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
      if (seen) parts.push({ text: n ? ' ✓' : '✓', color: '#16a34a' })
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

  const isOverview = selection.kind === 'overview'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onSelectOverview}
        aria-current={isOverview ? 'page' : undefined}
        className={`flex items-center justify-between gap-2 border-zinc-200 border-b px-3 py-2 text-left font-medium text-sm dark:border-zinc-800 ${
          isOverview
            ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
            : 'text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900'
        }`}
      >
        <span>Overview</span>
        <span
          className="rounded-full bg-zinc-200 px-1.5 text-[11px] text-zinc-700 leading-4 dark:bg-zinc-700 dark:text-zinc-200"
          title="Conversation items"
        >
          {conversationCount}
        </span>
      </button>
      <div className="flex items-center justify-between px-3 py-1.5 font-semibold text-[11px] text-zinc-500 uppercase tracking-wide">
        <span>Files ({files.length})</span>
        <span title="Viewed files">
          {viewed.size}/{files.length} viewed
        </span>
      </div>
      <FileTree
        model={model}
        aria-label="Changed files"
        className="block min-h-0 flex-1 text-[12.5px]"
      />
    </div>
  )
}
