import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { applyTheme } from './themes/apply'
import { readThemePreference, resolveAppearance, resolvePalette } from './themes/registry'

// Apply the persisted palette before the first React render so there is no
// flash of the default theme; ThemeProvider takes over from here.
const bootPreference = readThemePreference()
applyTheme(
  resolvePalette(bootPreference.palette),
  resolveAppearance(bootPreference, window.matchMedia('(prefers-color-scheme: dark)').matches),
)

const container = document.getElementById('root')
if (!container) throw new Error('coja: #root element not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
