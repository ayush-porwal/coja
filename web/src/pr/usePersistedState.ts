import { useEffect, useState } from 'react'

/**
 * `useState` mirrored into `localStorage` (JSON). Reads are validated with
 * `isValid` so a stale or foreign value falls back to the default. Storage
 * failures (private mode, quota) are ignored.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (isValid(parsed)) return parsed
      }
    } catch {
      // unreadable storage: use the default
    }
    return fallback
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // unwritable storage: state still works for this session
    }
  }, [key, value])

  return [value, setValue]
}
