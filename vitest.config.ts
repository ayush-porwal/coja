import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'agent',
          root: './packages/agent',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          root: './server',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: './web/vite.config.ts',
        test: {
          name: 'web',
          root: './web',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
  },
})
