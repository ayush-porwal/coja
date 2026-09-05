import { useEffect, useRef, useState } from 'react'

/**
 * `useState` mirrored into `localStorage` (JSON). Reads are validated with
 * `isValid` so a stale or foreign value falls back to the default. Storage
 * failures (private mode, quota) are ignored. When `key` changes, the value is
 * re-read under the new key instead of carrying the old key's value over.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const read = (k: string): T => {
    try {
      const raw = localStorage.getItem(k)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (isValid(parsed)) return parsed
      }
    } catch {
      // unreadable storage: use the default
    }
    return fallback
  }

  const [value, setValue] = useState<T>(() => read(key))
  const keyRef = useRef(key)

  useEffect(() => {
    if (keyRef.current !== key) {
      // Key switched (e.g. another PR): adopt that key's stored value; do not
      // write the previous key's value under the new key.
      keyRef.current = key
      setValue(read(key))
      return
    }
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // unwritable storage: state still works for this session
    }
  }, [key, value])

  return [value, setValue]
}
