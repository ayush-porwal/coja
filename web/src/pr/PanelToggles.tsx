import { cn, focusRing } from '../ui'

interface PanelTogglesProps {
  treeOpen: boolean
  onToggleTree(): void
  aiOpen: boolean
  onToggleAi(): void
  /**
   * Attention signals for the collapsed states: comment threads in the PR
   * (badge on the file-tree toggle) and context chips waiting in the AI
   * composer (badge on the AI toggle). A badge only shows while its panel is
   * collapsed — when the panel is open its content speaks for itself.
   */
  threadCount: number
  chipCount: number
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent)

/** "⌘B" / "⇧⌘B" on macOS, "Ctrl+B" / "Ctrl+Shift+B" elsewhere. */
export function panelShortcut(withShift: boolean): string {
  if (isMac) return `${withShift ? '⇧' : ''}⌘B`
  return `Ctrl${withShift ? '+Shift' : ''}+B`
}

/**
 * The VS Code-style layout toggle group at the left edge of the review top
 * bar: side-by-side rectangle glyphs whose active half is filled when the
 * panel it stands for is open. One toggle per side panel; the diff area
 * reflows to use the freed width.
 */
export function PanelToggles({
  treeOpen,
  onToggleTree,
  aiOpen,
  onToggleAi,
  threadCount,
  chipCount,
}: PanelTogglesProps) {
  return (
    <fieldset
      className="flex shrink-0 items-center gap-0.5 border-0 p-0"
      aria-label="Panel visibility"
    >
      <PanelToggle
        id="coja-toggle-tree"
        open={treeOpen}
        onPress={onToggleTree}
        label="Toggle file tree"
        shortcut={panelShortcut(false)}
      >
        <PanelGlyph side="left" open={treeOpen} />
        <ToggleBadge count={treeOpen ? 0 : threadCount} label="comment threads" />
      </PanelToggle>
      <PanelToggle
        id="coja-toggle-ai"
        open={aiOpen}
        onPress={onToggleAi}
        label="Toggle AI panel"
        shortcut={panelShortcut(true)}
      >
        <PanelGlyph side="right" open={aiOpen} />
        <ToggleBadge count={aiOpen ? 0 : chipCount} label="context chips" />
      </PanelToggle>
    </fieldset>
  )
}

interface PanelToggleProps {
  id: string
  open: boolean
  onPress(): void
  label: string
  shortcut: string
  children: React.ReactNode
}

function PanelToggle({ id, open, onPress, label, shortcut, children }: PanelToggleProps) {
  return (
    <button
      type="button"
      id={id}
      aria-pressed={open}
      aria-label={`${label} (${shortcut})`}
      title={`${label} (${shortcut})`}
      onClick={onPress}
      className={cn(
        'relative flex size-7 items-center justify-center rounded',
        focusRing,
        open ? 'text-ink' : 'text-faint hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The glyph: a screen outline with one half standing for the panel. Filled
 * half = panel open; hollow = collapsed. The tree is the left half, the AI
 * panel the right — matching their place in the three-zone layout.
 */
function PanelGlyph({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const half = side === 'left' ? { x: 3.4, width: 4.4 } : { x: 8.2, width: 4.4 }
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <rect
        x="1.75"
        y="2.75"
        width="12.5"
        height="10.5"
        rx="1.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {open ? (
        <rect x={half.x} y="4.6" width={half.width} height="6.8" rx="0.9" fill="currentColor" />
      ) : (
        <rect
          x={half.x}
          y="4.6"
          width={half.width}
          height="6.8"
          rx="0.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      )}
    </svg>
  )
}

function ToggleBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  const shown = count > 99 ? '99+' : count
  return (
    <>
      <span
        aria-hidden="true"
        className="-right-0.5 -top-0.5 absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-semibold text-[9px] leading-none text-accent-ink"
      >
        {shown}
      </span>
      <span className="sr-only">
        {count} {label}
      </span>
    </>
  )
}
