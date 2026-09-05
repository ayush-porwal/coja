import { useTheme } from '../themes/ThemeContext'
import { CODE_FONT_OPTIONS, TYPOGRAPHY_LIMITS, UI_FONT_OPTIONS } from '../typography'
import { Field, Select } from '../ui'

const PREVIEW_CODE = 'const answer = input !== null ? input => input + 1 : 0;'

/**
 * Typography preferences (Settings): UI/code font families, sizes, code line
 * height and ligatures, with a live preview. Changes apply immediately via the
 * theme context; preferences persist per browser and are independent of the
 * color palette.
 */
export function TypographySection() {
  const { typography, setTypography } = useTheme()

  const set = <K extends keyof typeof typography>(key: K, value: (typeof typography)[K]) =>
    setTypography({ ...typography, [key]: value })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="UI font" htmlFor="typo-ui-font">
          <Select
            id="typo-ui-font"
            value={typography.uiFont}
            onChange={(e) => {
              const option = UI_FONT_OPTIONS.find((o) => o.value === e.target.value)
              if (option) set('uiFont', option.value)
            }}
          >
            {UI_FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code font" htmlFor="typo-code-font">
          <Select
            id="typo-code-font"
            value={typography.codeFont}
            onChange={(e) => {
              const option = CODE_FONT_OPTIONS.find((o) => o.value === e.target.value)
              if (option) set('codeFont', option.value)
            }}
          >
            {CODE_FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={`UI size — ${typography.uiSize}px`} htmlFor="typo-ui-size">
          <input
            id="typo-ui-size"
            type="range"
            min={TYPOGRAPHY_LIMITS.uiSize.min}
            max={TYPOGRAPHY_LIMITS.uiSize.max}
            step={TYPOGRAPHY_LIMITS.uiSize.step}
            value={typography.uiSize}
            onChange={(e) => set('uiSize', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </Field>
        <Field label={`Code size — ${typography.codeSize}px`} htmlFor="typo-code-size">
          <input
            id="typo-code-size"
            type="range"
            min={TYPOGRAPHY_LIMITS.codeSize.min}
            max={TYPOGRAPHY_LIMITS.codeSize.max}
            step={TYPOGRAPHY_LIMITS.codeSize.step}
            value={typography.codeSize}
            onChange={(e) => set('codeSize', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </Field>
        <Field
          label={`Code line height — ${typography.codeLineHeight.toFixed(1)}`}
          htmlFor="typo-line-height"
        >
          <input
            id="typo-line-height"
            type="range"
            min={TYPOGRAPHY_LIMITS.codeLineHeight.min}
            max={TYPOGRAPHY_LIMITS.codeLineHeight.max}
            step={TYPOGRAPHY_LIMITS.codeLineHeight.step}
            value={typography.codeLineHeight}
            onChange={(e) => set('codeLineHeight', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={typography.codeLigatures}
          onChange={(e) => set('codeLigatures', e.target.checked)}
          className="accent-accent"
        />
        Programming ligatures in code (=&gt; !== =&gt;)
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Preview</legend>
        <div className="rounded-md border border-edge p-3 text-sm">
          <p>Browse pull requests — Review #2014 — files changed 6</p>
          <p
            className="mt-1 font-mono text-xs"
            style={{ fontVariantLigatures: typography.codeLigatures ? 'normal' : 'none' }}
          >
            {PREVIEW_CODE}
          </p>
          <p
            className="mt-1 font-mono text-xs"
            style={{ fontVariantLigatures: typography.codeLigatures ? 'normal' : 'none' }}
          >
            {'=>  ≠  ===  ->  '}
            {'\uf1132 \uf1136 \uf1427'}
          </p>
        </div>
      </fieldset>
    </div>
  )
}
