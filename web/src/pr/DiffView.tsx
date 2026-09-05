import type {
  BlobResponse,
  ChangedFile,
  ContextChip,
  FetchStatus,
  GitChangedFile,
  PullRequestDetail,
  ReviewThread,
} from '@coja/shared/api'
import {
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewScrollTarget,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type LineAnnotation,
  type PostRenderPhase,
  parsePatchFiles,
  type SelectedLineRange,
} from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { bridge } from './bridge'
import { CommentComposer } from './CommentComposer'
import { CommentThread } from './CommentThread'
import {
  DIFF_CSS_VARIABLES,
  DIFF_LAYOUT,
  DIFF_THEME,
  diffItemMetrics,
  isZeroHeightRender,
  languagesForPaths,
  preloadDiffHighlighter,
} from './diffLayout'
import { errorMessage } from './errors'
import { blobUrl, type DiffEntry, useAddComment, useSetViewed } from './hooks'
import {
  type AnnotationMeta,
  changeTypeLabel,
  describeRange,
  fileItemId,
  normalizeRange,
  pathFromItemId,
  rangeToRequest,
  threadToAnnotation,
  toAnnotationSide,
  toDiffSide,
} from './mapping'
import { SelectionPopover } from './SelectionPopover'
import { createScrollRetrier, type ScrollRetrier, scheduleAfterLayout } from './scrollRetry'
import type { DiffStyle, ScrollRequest } from './types'

interface DiffViewProps {
  projectId: string
  number: number
  detail: PullRequestDetail
  gitFiles: GitChangedFile[] | undefined
  diffs: ReadonlyMap<string, DiffEntry>
  loaded: number
  failed: number
  total: number
  fetchStatus: FetchStatus | undefined
  fetchError: Error | null
  onRetryFetch(): void
  diffStyle: DiffStyle
  scrollRequest: ScrollRequest | null
}

interface ComposerState {
  path: string
  range: SelectedLineRange
}

type Item = CodeViewItem<AnnotationMeta>
type Annotation = DiffLineAnnotation<AnnotationMeta>

interface CachedItem {
  fileDiff: FileDiffMetadata | undefined
  contents: string | undefined
  signature: string
  version: number
  item: Item
}

const HIGHLIGHT_MS = 2000

/** The parts of CodeView's per-item render context that `onPostRender` reads (it receives the whole record). */
interface PostRenderContext {
  item: { id: string }
  /** The item's current virtual height; 0 is the layout bug `isZeroHeightRender` describes. */
  height: number
  version: number | undefined
}

/** Events on the scroller that mean the user took over scrolling (CodeView drops its own pending target on the same ones). */
const USER_SCROLL_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

function buildAnnotations(
  threads: readonly ReviewThread[] | undefined,
  composer: ComposerState | null,
): Annotation[] {
  const list: Annotation[] = (threads ?? []).map(threadToAnnotation)
  if (composer) {
    const n = normalizeRange(composer.range)
    list.push({ side: n.endSide, lineNumber: n.end, metadata: { kind: 'composer' } })
  }
  return list
}

function annotationSignature(list: readonly Annotation[]): string {
  return list
    .map(
      (a) =>
        `${a.side}:${a.lineNumber}:${a.metadata.kind === 'thread' ? a.metadata.threadId : 'composer'}`,
    )
    .join('|')
}

/** What a non-diff placeholder item should say for a settled entry, or undefined when the patch is renderable. */
function placeholderContents(entry: Exclude<DiffEntry, 'loading'>): string | undefined {
  if (entry instanceof Error) return `(failed to load diff: ${entry.message})`
  if (entry.binary) return '(binary file)'
  if (entry.tooLarge) return '(diff too large to display)'
  if (entry.patch === '') return '(no textual changes)'
  return undefined
}

/**
 * Center pane: ONE virtualized `<CodeView>` holding every file's diff, built
 * progressively as patches arrive. Threads and the inline composer are
 * annotations; the selection popover offers Comment / Ask AI.
 */
export function DiffView({
  projectId,
  number,
  detail,
  gitFiles,
  diffs,
  loaded,
  failed,
  total,
  fetchStatus,
  fetchError,
  onRetryFetch,
  diffStyle,
  scrollRequest,
}: DiffViewProps) {
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta, undefined> | null>(null)
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [askBusy, setAskBusy] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const addComment = useAddComment(projectId, number)
  const setViewed = useSetViewed(projectId, number)

  // --- parse patches once per (path, patch) -------------------------------------------
  const parsedCache = useRef(
    new Map<string, { patch: string; fileDiff: FileDiffMetadata | null }>(),
  )
  const parsed = useMemo(() => {
    const out = new Map<string, FileDiffMetadata | null>()
    for (const [path, entry] of diffs) {
      if (entry === 'loading' || entry instanceof Error) continue
      if (placeholderContents(entry) !== undefined) continue
      const cached = parsedCache.current.get(path)
      if (cached && cached.patch === entry.patch) {
        out.set(path, cached.fileDiff)
        continue
      }
      const fileDiff =
        parsePatchFiles(entry.patch, `pr${number}:${path}`).flatMap((p) => p.files)[0] ?? null
      parsedCache.current.set(path, { patch: entry.patch, fileDiff })
      out.set(path, fileDiff)
    }
    return out
  }, [diffs, number])

  // --- lookup tables -------------------------------------------------------------------
  const filesByPath = useMemo(
    () => new Map<string, ChangedFile>(detail.files.map((f) => [f.path, f])),
    [detail.files],
  )
  const gitByPath = useMemo(
    () => new Map<string, GitChangedFile>((gitFiles ?? []).map((g) => [g.path, g])),
    [gitFiles],
  )
  const threadsByPath = useMemo(() => {
    const map = new Map<string, ReviewThread[]>()
    for (const thread of detail.threads) {
      const list = map.get(thread.path)
      if (list) list.push(thread)
      else map.set(thread.path, [thread])
    }
    return map
  }, [detail.threads])
  const threadsById = useMemo(
    () => new Map<string, ReviewThread>(detail.threads.map((t) => [t.id, t])),
    [detail.threads],
  )

  // --- CodeView items: stable identity per file, version bumped when annotations change ---
  const itemCache = useRef(new Map<string, CachedItem>())
  const items = useMemo(() => {
    const list: Item[] = []
    for (const file of detail.files) {
      const entry = diffs.get(file.path)
      if (entry === undefined || entry === 'loading') continue
      const id = fileItemId(file.path)
      let fileDiff: FileDiffMetadata | undefined
      let contents = placeholderContents(entry)
      if (contents === undefined) {
        const parsedDiff = parsed.get(file.path)
        if (parsedDiff) fileDiff = parsedDiff
        else contents = '(could not parse diff)'
      }
      const annotations = fileDiff
        ? buildAnnotations(
            threadsByPath.get(file.path),
            composer?.path === file.path ? composer : null,
          )
        : []
      const signature = annotationSignature(annotations)
      const prev = itemCache.current.get(file.path)
      if (
        prev &&
        prev.fileDiff === fileDiff &&
        prev.contents === contents &&
        prev.signature === signature
      ) {
        list.push(prev.item)
        continue
      }
      const version = (prev?.version ?? 0) + 1
      const item: Item = fileDiff
        ? { id, type: 'diff', fileDiff, annotations, version }
        : { id, type: 'file', file: { name: file.path, contents: contents ?? '' }, version }
      itemCache.current.set(file.path, { fileDiff, contents, signature, version, item })
      list.push(item)
    }
    return list
  }, [detail.files, diffs, parsed, threadsByPath, composer])
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items])

  // --- highlighter preload ---------------------------------------------------------------
  // With the grammars and themes loaded up front every item's first paint is synchronous,
  // so CodeView never runs its height reconciliation on an unpainted item (diffLayout.ts).
  // Time-boxed by the helper; a slow preload only means files highlight a moment later.
  const pathsKey = detail.files.map((f) => f.path).join('\n')
  const languages = useMemo(() => languagesForPaths(pathsKey.split('\n')), [pathsKey])
  const [highlighterReady, setHighlighterReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void preloadDiffHighlighter(languages).then(() => {
      if (!cancelled) setHighlighterReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [languages])

  // --- virtual layout healing --------------------------------------------------------------
  // Bumping the epoch changes `itemMetrics`, which makes CodeView recompute every item's
  // height from its estimates (diffItemMetrics). Requested from `onPostRender` when an
  // item painted with a zero virtual height; coalesced per frame and at most once per
  // item version so a persistent zero can never loop.
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const healedRenders = useRef(new Set<string>())
  const healFrame = useRef<number | null>(null)
  const queueLayoutHeal = () => {
    if (healFrame.current !== null) return
    healFrame.current = requestAnimationFrame(() => {
      healFrame.current = null
      setLayoutEpoch((epoch) => epoch + 1)
    })
  }
  useEffect(
    () => () => {
      if (healFrame.current !== null) cancelAnimationFrame(healFrame.current)
    },
    [],
  )

  // --- scroll requests from the tree and from citations -------------------------------
  // `scrollTo` resolves against the current virtual layout and forgets the target once the
  // position matches; the retrier re-issues it while the layout keeps settling and stops on
  // user intent (scrollRetry.ts). `jumpTarget` lets `onPostRender` nudge it when the target
  // item mounts.
  const retrier = useRef<ScrollRetrier | null>(null)
  const jumpTarget = useRef<string | null>(null)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!scroller) return
    const cancel = () => retrier.current?.cancel()
    for (const type of USER_SCROLL_INTENT_EVENTS) {
      scroller.addEventListener(type, cancel, { passive: true })
    }
    return () => {
      for (const type of USER_SCROLL_INTENT_EVENTS) scroller.removeEventListener(type, cancel)
    }
  }, [scroller])
  useEffect(() => () => retrier.current?.cancel(), [])

  const handledNonce = useRef(0)
  useEffect(() => {
    if (!scrollRequest || scrollRequest.nonce === handledNonce.current) return
    const id = fileItemId(scrollRequest.path)
    // Not renderable yet (diff still loading, or the CodeView not mounted): this effect
    // re-runs when items or readiness change and jumps as soon as the file exists.
    if (!highlighterReady || !itemIds.has(id) || !codeViewRef.current) return
    handledNonce.current = scrollRequest.nonce
    const { line } = scrollRequest
    const side = toAnnotationSide(scrollRequest.side)
    // Tree entries jump-scroll (design §3); citations animate so the eye can follow.
    const target: CodeViewScrollTarget =
      line === undefined
        ? { type: 'item', id, align: 'start', behavior: 'instant' }
        : { type: 'line', id, lineNumber: line, side, align: 'center', behavior: 'smooth-auto' }
    retrier.current?.cancel()
    jumpTarget.current = id
    const next = createScrollRetrier({
      issue: () => codeViewRef.current?.scrollTo(target),
      probe: () => {
        const instance = codeViewRef.current?.getInstance()
        if (!instance) return undefined
        return { top: instance.getTopForItem(id), scrollHeight: instance.getScrollHeight() }
      },
      schedule: scheduleAfterLayout,
    })
    retrier.current = next
    next.start()
    if (line === undefined) return
    const highlight: CodeViewLineSelection = { id, range: { start: line, end: line, side } }
    setSelection(highlight)
    setTimeout(
      () => setSelection((current) => (current === highlight ? null : current)),
      HIGHLIGHT_MS,
    )
  }, [scrollRequest, itemIds, highlighterReady])

  // A relayout moves every item after the healed one; re-aim the jump once it has landed.
  useEffect(() => {
    if (layoutEpoch > 0) retrier.current?.nudge()
  }, [layoutEpoch])

  // --- options (memoized; callbacks read the latest handlers through refs) ------------
  const gutterClick = useRef<(range: SelectedLineRange, itemId: string) => void>(() => {})
  gutterClick.current = (range, itemId) => setSelection({ id: itemId, range })
  const postRender = useRef<(phase: PostRenderPhase, context: PostRenderContext) => void>(() => {})
  postRender.current = (phase, context) => {
    const id = context.item.id
    if (isZeroHeightRender(phase, context.height)) {
      const key = `${id}#${context.version ?? 0}`
      if (!healedRenders.current.has(key)) {
        healedRenders.current.add(key)
        queueLayoutHeal()
      }
    }
    if (phase === 'mount' && id === jumpTarget.current) retrier.current?.nudge()
  }
  const options = useMemo<CodeViewReactOptions<AnnotationMeta, undefined>>(
    () => ({
      theme: DIFF_THEME,
      themeType: 'system',
      diffStyle,
      diffIndicators: 'classic',
      stickyHeaders: true,
      enableLineSelection: true,
      enableGutterUtility: true,
      lineHoverHighlight: 'both',
      layout: DIFF_LAYOUT,
      itemMetrics: diffItemMetrics(layoutEpoch),
      onGutterUtilityClick: (range: SelectedLineRange, context: { item: Item }) =>
        gutterClick.current(range, context.item.id),
      onPostRender: (
        _node: HTMLElement,
        _instance: unknown,
        phase: PostRenderPhase,
        context: PostRenderContext,
      ) => postRender.current(phase, context),
    }),
    [diffStyle, layoutEpoch],
  )

  // --- selection popover actions ---------------------------------------------------------
  const selectionInfo = useMemo(() => {
    if (!selection) return null
    return { path: pathFromItemId(selection.id), range: normalizeRange(selection.range) }
  }, [selection])

  const openComposer = () => {
    if (!selection) return
    setComposerError(null)
    setComposer({ path: pathFromItemId(selection.id), range: selection.range })
  }

  const askAi = async () => {
    if (!selectionInfo) return
    const { path: itemPath, range } = selectionInfo
    const side = toDiffSide(range.endSide)
    const ref = side === 'RIGHT' ? 'head' : 'base'
    // The LEFT side of a renamed file lives under its old name at the merge base.
    const path = ref === 'base' ? (gitByPath.get(itemPath)?.previousPath ?? itemPath) : itemPath
    setAskBusy(true)
    setAskError(null)
    try {
      const blob = await api.get<BlobResponse>(
        blobUrl(projectId, number, ref, path, range.start, range.end),
      )
      const chip: ContextChip = {
        id: crypto.randomUUID(),
        kind: 'selection',
        path,
        ref,
        side,
        startLine: range.start,
        endLine: range.end,
        text: blob.text,
      }
      bridge.attachSelection(chip)
      setSelection(null)
    } catch (error) {
      setAskError(errorMessage(error))
    } finally {
      setAskBusy(false)
    }
  }

  const submitComposer = async (body: string) => {
    if (!composer) return
    setComposerError(null)
    try {
      await addComment.mutateAsync(rangeToRequest(composer.path, composer.range, body))
      setComposer(null)
      setSelection(null)
    } catch (error) {
      setComposerError(errorMessage(error))
    }
  }

  // --- slot renderers (light DOM: Tailwind applies) ------------------------------------
  const renderAnnotation = (
    annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>,
    item: Item,
  ) => {
    const meta = annotation.metadata
    if (meta.kind === 'composer') {
      if (!composer || fileItemId(composer.path) !== item.id) return null
      return (
        <CommentComposer
          path={composer.path}
          range={normalizeRange(composer.range)}
          pending={addComment.isPending}
          error={composerError}
          onSubmit={(body) => void submitComposer(body)}
          onCancel={() => setComposer(null)}
        />
      )
    }
    const thread = threadsById.get(meta.threadId)
    if (!thread) return null
    return <CommentThread projectId={projectId} number={number} thread={thread} />
  }

  const renderHeaderMetadata = (item: Item) => {
    const path = pathFromItemId(item.id)
    const file = filesByPath.get(path)
    if (!file) return null
    return (
      <FileHeaderMeta
        file={file}
        previousPath={gitByPath.get(path)?.previousPath}
        onToggleViewed={(viewed) => setViewed.mutate({ path, viewed })}
      />
    )
  }

  // --- render ----------------------------------------------------------------------------
  const ready = fetchStatus?.state === 'ready'
  const fetchFailed = fetchError !== null || fetchStatus?.state === 'error'

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {ready && total > 0 && loaded < total && (
        <ProgressLine loaded={loaded} failed={failed} total={total} />
      )}
      {selectionInfo && !composer && (
        <SelectionPopover
          label={describeRange(selectionInfo.path, selectionInfo.range)}
          busy={askBusy}
          error={askError}
          onComment={openComposer}
          onAskAi={() => void askAi()}
          onDismiss={() => {
            setSelection(null)
            setAskError(null)
          }}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {items.length > 0 && highlighterReady ? (
          <CodeView<AnnotationMeta, undefined>
            ref={codeViewRef}
            containerRef={setScroller}
            items={items}
            options={options}
            className="coja-diff absolute inset-0 overflow-auto"
            style={DIFF_CSS_VARIABLES}
            selectedLines={selection}
            onSelectedLinesChange={setSelection}
            renderAnnotation={renderAnnotation}
            renderHeaderMetadata={renderHeaderMetadata}
          />
        ) : (
          <CenterMessage
            fetchFailed={fetchFailed}
            fetchMessage={fetchError?.message ?? fetchStatus?.error}
            ready={ready}
            preparing={items.length > 0}
            fileCount={detail.files.length}
            onRetryFetch={onRetryFetch}
          />
        )}
      </div>
    </div>
  )
}

interface FileHeaderMetaProps {
  file: ChangedFile
  previousPath: string | undefined
  onToggleViewed(viewed: boolean): void
}

function FileHeaderMeta({ file, previousPath, onToggleViewed }: FileHeaderMetaProps) {
  const isViewed = file.viewedState === 'VIEWED'
  const dismissed = file.viewedState === 'DISMISSED'
  const renamed = (file.changeType === 'RENAMED' || file.changeType === 'COPIED') && previousPath
  return (
    <span className="flex items-center gap-3 text-xs">
      {/* +/− counts are already in the built-in header; add only what it lacks. */}
      <span className="text-zinc-500">
        {renamed ? (
          <span title={`${previousPath} → ${file.path}`}>
            {changeTypeLabel(file.changeType)} from{' '}
            <span className="font-mono">{previousPath}</span>
          </span>
        ) : (
          changeTypeLabel(file.changeType)
        )}
      </span>
      <label
        className="flex cursor-pointer select-none items-center gap-1 text-zinc-700 dark:text-zinc-200"
        title={dismissed ? 'Changed since you viewed it' : 'Mark as viewed on GitHub'}
      >
        <input
          type="checkbox"
          checked={isViewed}
          onChange={(e) => onToggleViewed(e.target.checked)}
          className="accent-blue-600"
        />
        Viewed
        {dismissed && (
          <span className="text-amber-600 dark:text-amber-400"> · changed since viewed</span>
        )}
      </label>
    </span>
  )
}

function ProgressLine({
  loaded,
  failed,
  total,
}: {
  loaded: number
  failed: number
  total: number
}) {
  const pct = total ? Math.round((loaded / total) * 100) : 0
  return (
    <div
      className="shrink-0 border-zinc-200 border-b px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <span>
          Loading diffs {loaded}/{total}
          {failed ? ` · ${failed} failed` : ''}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full bg-blue-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

interface CenterMessageProps {
  fetchFailed: boolean
  fetchMessage: string | undefined
  ready: boolean
  /** Diffs are in hand but the highlighter is still loading (see the preload in DiffView). */
  preparing: boolean
  fileCount: number
  onRetryFetch(): void
}

function CenterMessage({
  fetchFailed,
  fetchMessage,
  ready,
  preparing,
  fileCount,
  onRetryFetch,
}: CenterMessageProps) {
  let content: React.ReactNode
  if (fetchFailed) {
    content = (
      <div className="max-w-md rounded-md border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">Could not fetch the PR objects</p>
        <p className="mt-1 break-words text-xs">{fetchMessage ?? 'Unknown error'}</p>
        <button
          type="button"
          onClick={onRetryFetch}
          className="mt-3 rounded bg-red-600 px-3 py-1 font-medium text-white text-xs hover:bg-red-700"
        >
          Retry fetch
        </button>
      </div>
    )
  } else if (preparing) {
    content = (
      <p className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500"
          aria-hidden="true"
        />
        Preparing diff…
      </p>
    )
  } else if (!ready) {
    content = (
      <p className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"
          aria-hidden="true"
        />
        Fetching PR objects… the diff renders as they arrive.
      </p>
    )
  } else if (fileCount === 0) {
    content = <p>This pull request has no changed files.</p>
  } else {
    content = <p>Loading diffs…</p>
  }
  return (
    <div
      className="flex h-full items-center justify-center p-6 text-sm text-zinc-500"
      role="status"
    >
      {content}
    </div>
  )
}
