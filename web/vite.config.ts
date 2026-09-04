import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Anchor everything on this file so the config behaves the same whether Vite is
// started from `web/` or the root Vitest config extends it from the repo root.
const webRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Mirrors the `paths` entry in tsconfig.json: types shared with the server.
      '@coja/shared': fileURLToPath(new URL('../server/src/shared', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4321',
    },
  },
  build: {
    // The server package ships the built UI as static assets.
    outDir: '../server/public',
    emptyOutDir: true,
  },
})
