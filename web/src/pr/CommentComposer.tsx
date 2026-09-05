import { useEffect, useRef, useState } from 'react'
import { describeRange, type NormalizedRange } from './mapping'

interface CommentComposerProps {
  path: string
  range: NormalizedRange
  pending: boolean
  error: string | null
  onSubmit(body: string): void
  onCancel(): void
}

/** Inline "new review comment" box rendered as a diff annotation under the selected line. */
export function CommentComposer({
  path,
  range,
  pending,
  error,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSubmit = body.trim().length > 0 && !pending
  const submit = () => {
    if (canSubmit) onSubmit(body.trim())
  }

  return (
    <div className="my-1 rounded-md border border-blue-300 bg-white p-2 text-sm shadow-sm dark:border-blue-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">New review comment</span>
        <span className="truncate font-mono">{describeRange(path, range)}</span>
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        rows={3}
        disabled={pending}
        placeholder="Leave a comment — it joins your pending review, invisible to others until you submit"
        className="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add review comment'}
        </button>
      </div>
    </div>
  )
}
