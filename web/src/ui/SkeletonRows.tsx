const ROW_IDS = ['one', 'two', 'three', 'four', 'five', 'six'] as const

/** Placeholder rows shown while a list loads; shaped like the real rows so nothing jumps. */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <ul
      aria-busy="true"
      aria-label={label}
      className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {ROW_IDS.slice(0, rows).map((id) => (
        <li key={id} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 w-10 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </li>
      ))}
    </ul>
  )
}
