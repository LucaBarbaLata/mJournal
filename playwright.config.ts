import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app (built output in ./out) with a
// throwaway data folder per test. See tests/e2e/fixtures.ts.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
});
