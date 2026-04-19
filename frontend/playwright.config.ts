import { defineConfig } from '@playwright/test'

// Most spec files use unique user emails (or per-test testId emails) and write
// only to user-scoped data, so different files can safely run in parallel
// against the single backend instance. epic-mode.spec.ts is the exception:
// while a test is running, the global epic_mode flag is on, which makes every
// other user's grant/loan/price writes return 403. It runs alone after the
// parallel "main" project completes.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  workers: process.env.CI ? 4 : 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 375, height: 812 },
    browserName: 'chromium',
  },
  projects: [
    {
      name: 'main',
      testIgnore: ['**/epic-mode.spec.ts'],
    },
    {
      name: 'epic-mode',
      testMatch: ['**/epic-mode.spec.ts'],
      dependencies: ['main'],
    },
  ],
})
