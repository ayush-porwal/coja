import { useTheme } from '../themes/ThemeContext'
import { TYPOGRAPHY_DEFAULTS, TYPOGRAPHY_LIMITS } from '../typography'
import { Button, Field } from '../ui'

const PREVIEW_CODE = `function greet(name: string) {
  const message = \`Hello, \${name}!\`;
  return message;
}`

export function TypographySection() {
  const { typography, setTypography, resetTypography } = useTheme()
  const isDefault =
    typography.codeSize === TYPOGRAPHY_DEFAULTS.codeSize &&
    typography.codeLineHeight === TYPOGRAPHY_DEFAULTS.codeLineHeight

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={`Font size · ${typography.codeSize}px`} htmlFor="typo-code-size">
          <input
            id="typo-code-size"
            type="range"
            {...TYPOGRAPHY_LIMITS.codeSize}
            value={typography.codeSize}
            aria-valuetext={`${typography.codeSize} pixels`}
            onChange={(e) => setTypography({ ...typography, codeSize: Number(e.target.value) })}
            className="h-6 w-full cursor-pointer accent-accent"
          />
        </Field>
        <Field
          label={`Line height · ${typography.codeLineHeight.toFixed(1)}×`}
          htmlFor="typo-line-height"
        >
          <input
            id="typo-line-height"
            type="range"
            {...TYPOGRAPHY_LIMITS.codeLineHeight}
            value={typography.codeLineHeight}
            aria-valuetext={`${typography.codeLineHeight.toFixed(1)} times font size`}
            onChange={(e) =>
              setTypography({ ...typography, codeLineHeight: Number(e.target.value) })
            }
            className="h-6 w-full cursor-pointer accent-accent"
          />
        </Field>
      </div>
      <figure className="min-w-0 overflow-hidden rounded-lg border border-edge">
        <figcaption className="border-b border-edge px-4 py-2 text-xs text-muted">
          Code preview
        </figcaption>
        <pre
          className="overflow-x-auto bg-code p-4 text-code-ink"
          style={{
            fontFamily: 'var(--coja-code-font)',
            fontSize: typography.codeSize,
            lineHeight: typography.codeLineHeight,
          }}
        >
          <code>{PREVIEW_CODE}</code>
        </pre>
      </figure>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Changes are saved automatically in this browser.</p>
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={resetTypography}>
          Reset code defaults
        </Button>
      </div>
    </div>
  )
}
