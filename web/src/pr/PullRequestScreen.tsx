import type { PullRequestDetail } from '@coja/shared/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { BrandLoader } from '../brand/BrandLoader'
import { useTheme } from '../themes/ThemeContext'
import { AiPanel } from './ai/AiPanel'
import { bridge } from './bridge'
import { DiffView } from './DiffView'
import { type DiffTarget, useFetchStatus, useFileDiffs, useGitFiles, usePullRequest } from './hooks'
import { Overview } from './Overview'
import { PanelResizeHandle } from './PanelResizeHandle'
import { ReviewDialog } from './ReviewDialog'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import {
  type CenterSelection,
  type DiffStyle,
  isBoolean,
  isDiffStyle,
  isPanelWidth,
  type ScrollRequest,
} from './types'
import { usePanelShortcuts } from './usePanelShortcuts'
import { usePersistedState } from './usePersistedState'
import './pr.css'

const OVERVIEW: CenterSelection = { kind: 'overview' }
const TOAST_MS = 3500

/** Panel width bounds in px (drag clamps live; the validator bounds storage). */
export const TREE_PANEL_MIN = 200
export const TREE_PANEL_MAX = 460
export const TREE_PANEL_DEFAULT = 288
export const AI_PANEL_MIN = 300
export const AI_PANEL_MAX = 640
export const AI_PANEL_DEFAULT = 380

/** Route: `/p/:projectId/prs/:number` (any route providing these params works). */
export function PullRequestScreen() {
  const { projectId = '', number: numberParam = '' } = useParams()
  const number = Number.parseInt(numberParam, 10)
  if (!projectId || !Number.isInteger(number) || number <= 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas p-6 text-sm text-muted">
        <p>
          Invalid pull request route.{' '}
          <Link to="/" className="text-accent-text underline">
            Back to projects
          </Link>
        </p>
      </main>
    )
  }
  // Keyed so all per-PR state (selection, composer, chips) resets when the route changes.
  return <ReviewScreen key={`${projectId}#${number}`} projectId={projectId} number={number} />
}

export default PullRequestScreen

interface ReviewScreenProps {
  projectId: string
  number: number
}

/** The three-zone review screen (design.md §3). Full-bleed; no AppShell. */
function ReviewScreen({ projectId, number }: ReviewScreenProps) {
  const pr = usePullRequest(projectId, number)
  const { palette, appearance } = useTheme()
  const fetch = useFetchStatus(projectId, number)
  const ready = fetch.status?.state === 'ready'
  const gitFiles = useGitFiles(projectId, number, ready)

  // Diff targets need git's `previousPath` for renames, so wait for the git file list
  // (or its failure) before loading patches.
  const files = pr.data?.files
  const targets = useMemo<DiffTarget[] | undefined>(() => {
    if (!files || !ready || gitFiles.isPending) return undefined
    const previousByPath = new Map((gitFiles.data ?? []).map((g) => [g.path, g.previousPath]))
    return files.map((f) => ({ path: f.path, previousPath: previousByPath.get(f.path) }))
  }, [files, ready, gitFiles.isPending, gitFiles.data])
  const fileDiffs = useFileDiffs(projectId, number, targets, ready, fetch.status?.headOid)

  const [selection, setSelection] = useState<CenterSelection>(OVERVIEW)
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null)
  const nonce = useRef(0)
  const [diffStyle, setDiffStyle] = usePersistedState('coja.diffStyle', 'unified', isDiffStyle)
  const [aiOpen, setAiOpen] = usePersistedState('coja.aiPanelOpen', true, isBoolean)
  const [treeOpen, setTreeOpen] = usePersistedState('coja.fileTreePanelOpen', true, isBoolean)
  const [treeWidth, setTreeWidth] = usePersistedState(
    'coja.treePanelWidth',
    TREE_PANEL_DEFAULT,
    isPanelWidth,
  )
  const [aiWidth, setAiWidth] = usePersistedState(
    'coja.aiPanelWidth',
    AI_PANEL_DEFAULT,
    isPanelWidth,
  )
  const [reviewOpen, setReviewOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [chipCount, setChipCount] = useState(0)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const [mobilePanel, setMobilePanel] = useState<'tree' | 'ai' | null>(null)
  const showTree = compact ? mobilePanel === 'tree' : treeOpen
  const showAi = compact ? mobilePanel === 'ai' : aiOpen

  const treeAside = useRef<HTMLElement | null>(null)
  const aiAside = useRef<HTMLElement | null>(null)
  const centerPane = useRef<HTMLElement | null>(null)

  // Hiding a focused panel makes the browser drop focus to <body> before any
  // effect can observe where it was (jsdom doesn't model this), so ownership
  // is captured at the moment a hide is triggered and spent by the effect below.
  const panelOwnsFocus = useRef(false)
  const notePanelFocus = useCallback(() => {
    const active = document.activeElement
    panelOwnsFocus.current = Boolean(
      active !== document.body &&
        (treeAside.current?.contains(active) || aiAside.current?.contains(active)),
    )
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    // Crossing the breakpoint can hide a panel (persisted-open panels collapse
    // to `mobilePanel: null`), so capture focus ownership before `setCompact`.
    const update = () => {
      notePanelFocus()
      setCompact(media.matches)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [notePanelFocus])

  useEffect(() => {
    if (compact && mobilePanel === null && panelOwnsFocus.current) {
      panelOwnsFocus.current = false
      centerPane.current?.focus()
    }
  }, [compact, mobilePanel])

  // Collapsing a panel that holds the keyboard focus would drop focus onto
  // <body>; park it on the panel's toggle instead (and cancel the center-pane
  // hand-off — the toggle keeps focus).
  const moveFocusToToggle = useCallback((aside: HTMLElement | null, toggleId: string) => {
    const active = document.activeElement
    if (aside && active !== null && active !== document.body && aside.contains(active)) {
      panelOwnsFocus.current = false
      document.getElementById(toggleId)?.focus()
    }
  }, [])
  const toggleTree = useCallback(() => {
    notePanelFocus()
    moveFocusToToggle(treeAside.current, 'coja-toggle-tree')
    if (compact) setMobilePanel((panel) => (panel === 'tree' ? null : 'tree'))
    else setTreeOpen((open) => !open)
  }, [compact, moveFocusToToggle, notePanelFocus, setTreeOpen])
  const toggleAi = useCallback(() => {
    notePanelFocus()
    moveFocusToToggle(aiAside.current, 'coja-toggle-ai')
    if (compact) setMobilePanel((panel) => (panel === 'ai' ? null : 'ai'))
    else setAiOpen((open) => !open)
  }, [compact, moveFocusToToggle, notePanelFocus, setAiOpen])
  usePanelShortcuts({ onToggleTree: toggleTree, onToggleAi: toggleAi })

  const openFile = useCallback(
    (path: string, line?: number, side?: ScrollRequest['side']) => {
      nonce.current += 1
      notePanelFocus()
      setSelection({ kind: 'file', path })
      setScrollRequest({ path, line, side, nonce: nonce.current })
      setMobilePanel(null)
    },
    [notePanelFocus],
  )

  // The top bar's Changes segments: switch the layout, and leave Conversation
  // for the first changed file (the top of the diff) without forcing a jump
  // when the reviewer is already reading deeper into the diff.
  const selectChanges = useCallback(
    (style: DiffStyle) => {
      notePanelFocus()
      setMobilePanel(null)
      setDiffStyle(style)
      setSelection((prev) => {
        if (prev.kind === 'file') return prev
        const first = pr.data?.files[0]?.path
        return first ? { kind: 'file', path: first } : prev
      })
    },
    [notePanelFocus, pr.data, setDiffStyle],
  )
  const selectConversation = useCallback(() => {
    notePanelFocus()
    setSelection(OVERVIEW)
    setMobilePanel(null)
  }, [notePanelFocus])

  // Citations in AI output navigate the diff; "Ask AI" reveals the panel.
  useEffect(
    () => bridge.onScrollToLine((target) => openFile(target.path, target.line, target.side)),
    [openFile],
  )
  useEffect(
    () =>
      bridge.onAttachSelection(() => {
        if (compact) setMobilePanel('ai')
        else setAiOpen(true)
      }),
    [compact, setAiOpen],
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const detail: PullRequestDetail | undefined = pr.data

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <TopBar
        projectId={projectId}
        number={number}
        detail={detail}
        fetchStatus={fetch.status}
        fetchError={fetch.error}
        onRetryFetch={fetch.retry}
        view={selection.kind === 'overview' ? 'conversation' : 'changes'}
        diffStyle={diffStyle}
        onConversation={selectConversation}
        onChanges={selectChanges}
        treeOpen={showTree}
        onToggleTree={toggleTree}
        aiOpen={showAi}
        onToggleAi={toggleAi}
        threadCount={detail?.threads.length ?? 0}
        chipCount={chipCount}
        onOpenReview={() => setReviewOpen(true)}
      />

      {detail ? (
        <div className="flex min-h-0 flex-1">
          {/* Kept mounted while collapsed so the tree keeps its expansion and scroll state.
              The width is capped at half the viewport (minus the other panel's share) so a
              narrow window can never squeeze the diff away — CSS recomputes live on resize. */}
          <aside
            ref={treeAside}
            hidden={!showTree}
            style={{ width: compact ? '100%' : `min(${treeWidth}px, calc(50vw - 140px))` }}
            className="flex min-w-0 shrink-0 flex-col border-edge border-r bg-panel"
            aria-label="File tree"
          >
            <Sidebar
              files={detail.files}
              threads={detail.threads}
              conversationCount={detail.conversation.length}
              selection={selection}
              onSelectOverview={selectConversation}
              onSelectFile={(path) => openFile(path)}
            />
          </aside>
          {showTree && !compact && (
            <PanelResizeHandle
              side="left"
              width={treeWidth}
              onResize={setTreeWidth}
              label="Resize file tree panel"
              min={TREE_PANEL_MIN}
              max={TREE_PANEL_MAX}
            />
          )}

          <main
            ref={centerPane}
            tabIndex={-1}
            hidden={compact && mobilePanel !== null}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {selection.kind === 'overview' ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Overview detail={detail} />
              </div>
            ) : (
              <DiffView
                projectId={projectId}
                number={number}
                detail={detail}
                gitFiles={gitFiles.data}
                diffs={fileDiffs.diffs}
                loaded={fileDiffs.loaded}
                failed={fileDiffs.failed}
                total={fileDiffs.total}
                fetchStatus={fetch.status}
                fetchError={fetch.error}
                onRetryFetch={fetch.retry}
                diffStyle={diffStyle}
                scrollRequest={scrollRequest}
              />
            )}
          </main>

          {showAi && !compact && (
            <PanelResizeHandle
              side="right"
              width={aiWidth}
              onResize={setAiWidth}
              label="Resize AI panel"
              min={AI_PANEL_MIN}
              max={AI_PANEL_MAX}
            />
          )}
          {/* Kept mounted while collapsed so attached chips survive the toggle (same viewport cap as the tree). */}
          <aside
            ref={aiAside}
            hidden={!showAi}
            style={{ width: compact ? '100%' : `min(${aiWidth}px, calc(50vw - 140px))` }}
            className="flex min-w-0 shrink-0 flex-col border-edge border-l bg-panel"
            aria-label="AI panel"
          >
            <AiPanel
              projectId={projectId}
              number={number}
              detail={detail}
              onChipsChange={setChipCount}
            />
          </aside>
        </div>
      ) : (
        <div
          className="flex flex-1 items-center justify-center p-6 text-sm text-muted"
          role="status"
        >
          {pr.isError ? (
            <div className="max-w-md rounded-md border border-danger bg-canvas p-4 text-danger-text">
              <p className="font-medium">Could not load pull request #{number}</p>
              <p className="mt-1 break-words text-xs">{pr.error.message}</p>
              <button
                type="button"
                onClick={() => void pr.refetch()}
                className="mt-3 rounded bg-danger-button px-3 py-1 font-medium text-xs text-status-button-ink hover:opacity-90"
              >
                Retry
              </button>
            </div>
          ) : (
            <BrandLoader
              paletteId={palette.id}
              appearance={appearance}
              size="large"
              label="Loading pull request…"
              /* Same rationale as the boot splash: 2.5x finishes the write
                 about when the detail query resolves. */
              speed={2.5}
            />
          )}
        </div>
      )}

      {detail && (
        <ReviewDialog
          open={reviewOpen}
          projectId={projectId}
          number={number}
          pendingCount={detail.pendingReview?.commentCount ?? 0}
          hasPendingReview={detail.pendingReview !== null}
          onClose={() => setReviewOpen(false)}
          onDone={setToast}
        />
      )}

      {toast && (
        <output className="fixed bottom-4 left-1/2 z-50 block -translate-x-1/2 rounded-md bg-ink px-4 py-2 text-sm text-canvas shadow-lg">
          {toast}
        </output>
      )}
    </div>
  )
}
