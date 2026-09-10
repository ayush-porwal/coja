import { afterEach, expect, it } from 'vitest'
import { readTypographyPrefs, TYPOGRAPHY_STORAGE_KEY, typographyCssVariables } from './typography'

afterEach(() => localStorage.clear())

it('preserves saved code sizing while retiring UI and font preferences', () => {
  localStorage.setItem(
    TYPOGRAPHY_STORAGE_KEY,
    JSON.stringify({
      uiFont: 'system',
      uiSize: 18,
      codeFont: 'system',
      codeLigatures: false,
      codeSize: 15,
      codeLineHeight: 1.8,
    }),
  )
  const prefs = readTypographyPrefs()
  expect(prefs).toEqual({ codeSize: 15, codeLineHeight: 1.8 })
  expect(typographyCssVariables(prefs)).toMatchObject({
    '--coja-ui-size': '16px',
    '--coja-ui-font': '"IBM Plex Sans", system-ui, sans-serif',
    '--coja-code-size': '15px',
    '--coja-code-line-height': '1.8',
  })
})
