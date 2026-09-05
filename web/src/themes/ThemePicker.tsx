import { cn, focusRing } from '../ui'
import { PALETTES, type ThemeAppearance } from './palettes'
import { useTheme } from './ThemeContext'
import { ThemeSwatch } from './ThemeSwatch'

const APPEARANCES: { value: 'system' | ThemeAppearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * The full theme picker (Setup): every palette as a labelled swatch row, plus
 * the appearance control. The same preference the top-bar quick switcher
 * writes; both render from the one registry.
 */
export function ThemePicker() {
  const { preference, setPreference, appearance } = useTheme()
  return (
    <div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Palette</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {PALETTES.map((entry) => {
            const selected = entry.id === preference.palette
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPreference({ ...preference, palette: entry.id })}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm',
                  focusRing,
                  selected
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-edge text-ink hover:bg-hover',
                )}
              >
                <ThemeSwatch palette={entry} appearance={appearance} size="md" />
                <span className="flex-1">
                  <span className="block font-medium">{entry.label}</span>
                  <span className="block text-xs text-muted">
                    {appearance === 'dark' ? 'Dark' : 'Light'} variant
                  </span>
                </span>
                {selected && <span className="text-xs font-medium text-accent">Active</span>}
              </button>
            )
          })}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-muted">Appearance</legend>
        <div className="inline-flex gap-0.5 rounded-md border border-edge p-0.5">
          {APPEARANCES.map((option) => {
            const selected = preference.appearance === option.value
            const inputId = `appearance-${option.value}`
            return (
              <label
                key={option.value}
                htmlFor={inputId}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
                  selected
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:bg-hover hover:text-ink',
                  focusRing,
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="appearance"
                  value={option.value}
                  checked={selected}
                  onChange={() => setPreference({ ...preference, appearance: option.value })}
                  className="sr-only"
                />
                {option.label}
              </label>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
