import { registerCustomCSSVariableTheme, type ThemesType } from '@pierre/diffs'

/**
 * The two highlighter themes coja renders diffs with. Both are Shiki
 * CSS-variables themes (`createCssVariablesTheme` under the hood): every token
 * colour is emitted as `var(--diffs-token-…)`, and `applyTheme` defines those
 * variables from the active palette on `:root` — so switching palette or
 * appearance restyles the diff by pure CSS; no re-tokenization, and one
 * mechanism serves every theme in the registry.
 *
 * The defaults below only apply if the variables are missing (e.g. a code
 * surface rendered before the theme applied); they mirror a neutral GitHub-ish
 * ramp so even that state stays readable.
 */

export const COJA_DIFF_THEMES: ThemesType = {
  dark: 'coja-dark',
  light: 'coja-light',
}

const LIGHT_DEFAULTS = {
  background: '#ffffff',
  foreground: '#1f2328',
  'token-string': '#0a3069',
  'token-comment': '#6e7781',
  'token-constant': '#0550ae',
  'token-keyword': '#cf222e',
  'token-parameter': '#953800',
  'token-function': '#8250df',
  'token-string-expression': '#116329',
  'token-punctuation': '#57606a',
  'token-link': '#0a3069',
  'token-inserted': '#116329',
  'token-deleted': '#82071e',
  'token-changed': '#953800',
}

const DARK_DEFAULTS = {
  background: '#0d1117',
  foreground: '#e6edf3',
  'token-string': '#a5d6ff',
  'token-comment': '#8b949e',
  'token-constant': '#79c0ff',
  'token-keyword': '#ff7b72',
  'token-parameter': '#ffa657',
  'token-function': '#d2a8ff',
  'token-string-expression': '#7ee787',
  'token-punctuation': '#e6edf3',
  'token-link': '#a5d6ff',
  'token-inserted': '#7ee787',
  'token-deleted': '#ffa198',
  'token-changed': '#ffa657',
}

let registered = false

/** Idempotent so test imports and app boot can both call it. */
export function registerCojaDiffThemes(): void {
  if (registered) return
  registered = true
  registerCustomCSSVariableTheme('coja-light', LIGHT_DEFAULTS)
  registerCustomCSSVariableTheme('coja-dark', DARK_DEFAULTS)
}

registerCojaDiffThemes()
