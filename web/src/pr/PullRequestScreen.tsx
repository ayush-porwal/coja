import type { PullRequestDetail } from '@coja/shared/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AiPanel } from './ai/AiPanel'
import { bridge } from './bridge'
import { DiffView } from './DiffView'
import { type DiffTarget, useFetchStatus, useFileDiffs, useGitFiles, usePullRequest } from './hooks'
import { Overview } from './Overview'
import { ReviewDialog } from './ReviewDialog'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { type CenterSelection, isBoolean, isDiffStyle, type ScrollRequest } from './types'
import { usePersistedState } from './usePersistedState'
import './pr.css'

const OVERVIEW: CenterSelection = { kind: 'overview' }
const TOAST_MS = 3500

/** Route: `/p/:projectId/prs/:number` (any route providing these params works). */
export function PullRequestScreen() {
  const { projectId = '', number: numberParam = '' } = useParams()
  const number = Number.parseInt(numberParam, 10)
  if (!projectId || !Number.isInteger(number) || number <= 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-white p-6 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
        <p>
          Invalid pull request route.{' '}
          <Link to="/" className="text-blue-600 underline dark:text-blue-400">
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
  const [reviewOpen, setReviewOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const openFile = useCallback((path: string, line?: number, side?: ScrollRequest['side']) => {
    nonce.current += 1
    setSelection({ kind: 'file', path })
    setScrollRequest({ path, line, side, nonce: nonce.current })
  }, [])

  // Citations in AI output navigate the diff; "Ask AI" reveals the panel.
  useEffect(
    () => bridge.onScrollToLine((target) => openFile(target.path, target.line, target.side)),
    [openFile],
  )
  useEffect(() => bridge.onAttachSelection(() => setAiOpen(true)), [setAiOpen])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const detail: PullRequestDetail | undefined = pr.data

  return (
    <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <TopBar
        projectId={projectId}
        number={number}
        detail={detail}
        fetchStatus={fetch.status}
        fetchError={fetch.error}
        onRetryFetch={fetch.retry}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((open) => !open)}
        onOpenReview={() => setReviewOpen(true)}
      />

      {detail ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-zinc-200 border-r dark:border-zinc-800">
            <Sidebar
              files={detail.files}
              threads={detail.threads}
              conversationCount={detail.conversation.length}
              selection={selection}
              onSelectOverview={() => setSelection(OVERVIEW)}
              onSelectFile={(path) => openFile(path)}
            />
          </aside>

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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

          {/* Kept mounted while collapsed so attached chips survive the toggle. */}
          <aside
            hidden={!aiOpen}
            className="flex w-[380px] shrink-0 flex-col border-zinc-200 border-l dark:border-zinc-800"
            aria-label="AI panel"
          >
            <AiPanel projectId={projectId} number={number} detail={detail} />
          </aside>
          {!aiOpen && (
            <div className="flex w-9 shrink-0 flex-col items-center border-zinc-200 border-l pt-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                title="Show AI panel"
                className="rounded border border-zinc-300 px-1.5 py-1 font-medium text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                AI
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500"
          role="status"
        >
          {pr.isError ? (
            <div className="max-w-md rounded-md border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">Could not load pull request #{number}</p>
              <p className="mt-1 break-words text-xs">{pr.error.message}</p>
              <button
                type="button"
                onClick={() => void pr.refetch()}
                className="mt-3 rounded bg-red-600 px-3 py-1 font-medium text-white text-xs hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          ) : (
            <p>Loading pull request…</p>
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
        <output className="fixed bottom-4 left-1/2 z-50 block -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </output>
      )}
    </div>
  )
}
