/**
 * Wire types shared between the server and the web UI.
 *
 * The web package imports this directory through the `@coja/shared/*` alias
 * (tsconfig `paths` + Vite `resolve.alias`), so keep it free of Node and DOM
 * imports: it must compile in both environments.
 */

export const API_ROUTES = {
  health: '/api/health',
} as const

export interface HealthResponse {
  ok: true
  version: string
}
