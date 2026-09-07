import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { readTypographyPrefs, TYPOGRAPHY_DEFAULTS, writeTypographyPrefs } from '../typography'
import { readThemePreference, writeThemePreference } from './registry'
import { ThemeProvider, useTheme } from './ThemeContext'

function Controls() {
  const { typography, resetTypography } = useTheme()
  return (
    <>
      <output>{JSON.stringify(typography)}</output>
      <button type="button" onClick={resetTypography}>
        Reset typography
      </button>
    </>
  )
}

it('resets custom typography, persists the defaults, and preserves the color theme', () => {
  localStorage.clear()
  const theme = { palette: 'ocean', appearance: 'light' } as const
  writeThemePreference(theme)
  writeTypographyPrefs({
    ...TYPOGRAPHY_DEFAULTS,
    uiSize: 18,
    codeSize: 18,
    codeLineHeight: 2,
    codeLigatures: false,
  })
  const first = render(
    <ThemeProvider>
      <Controls />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reset typography' }))
  expect(readTypographyPrefs()).toEqual(TYPOGRAPHY_DEFAULTS)
  expect(readThemePreference()).toEqual(theme)
  expect(document.documentElement.style.getPropertyValue('--coja-ui-size')).toBe('14px')
  expect(document.documentElement.style.getPropertyValue('--coja-code-size')).toBe('12.5px')
  expect(document.documentElement.style.getPropertyValue('--coja-code-ligatures')).toBe('normal')
  first.unmount()
  render(
    <ThemeProvider>
      <Controls />
    </ThemeProvider>,
  )
  expect(screen.getByRole('status').textContent).toBe(JSON.stringify(TYPOGRAPHY_DEFAULTS))
  localStorage.clear()
})
