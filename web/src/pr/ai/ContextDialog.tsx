import { useEffect, useRef } from 'react'
import { Button, ErrorNotice, Spinner } from '../../ui'
import { errorMessage } from '../errors'
import { useAiContext } from './hooks'

export interface ContextDialogProps {
  open: boolean
  onClose(): void
  projectId: string
  number: number
}

/**
 * "What gets sent" (design.md §4): the standing system prompt, verbatim,
 * and the tools the model can call. Fetched only while the dialog is open.
 */
export function ContextDialog({ open, onClose, projectId, number }: ContextDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const context = useAiContext(projectId, number, open)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      aria-labelledby="ai-context-title"
      className="m-auto w-[min(48rem,calc(100vw-2rem))] rounded-lg border border-edge bg-card p-0 text-sm text-ink shadow-xl backdrop:bg-black/40"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center gap-2 border-edge border-b px-4 py-3">
            <h2 id="ai-context-title" className="font-semibold">
              What gets sent
            </h2>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-xs text-muted">
              Every turn the model receives this system prompt, the conversation above (including
              each context chip exactly as shown), and the results of the tool calls it makes — all
              of which are rendered in the chat.
            </p>
            {context.isPending && (
              <div className="mt-4 flex items-center gap-2 text-muted">
                <Spinner size="sm" /> Loading…
              </div>
            )}
            {context.isError && (
              <ErrorNotice
                className="mt-4"
                title="Could not load the context"
                message={errorMessage(context.error)}
                onRetry={() => void context.refetch()}
                retrying={context.isFetching}
              />
            )}
            {context.data && (
              <>
                <h3 className="mt-4 mb-1 font-medium">System prompt</h3>
                <pre
                  data-testid="system-prompt"
                  className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded border border-edge bg-canvas p-3 font-mono text-[11px] leading-snug"
                >
                  {context.data.system}
                </pre>
                <h3 className="mt-4 mb-1 font-medium">Tools</h3>
                <ul aria-label="Tools" className="flex flex-col gap-1.5">
                  {context.data.tools.map((tool) => (
                    <li key={tool.name} className="text-xs">
                      <code className="font-mono font-medium">{tool.name}</code>
                      <span className="text-muted"> — {tool.description}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  )
}
