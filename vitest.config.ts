import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // the e2e harness plays crawl itself: `npm run e2e` (vitest.e2e.config.ts)
    exclude: ['**/node_modules/**', 'apps/*/test/e2e/**'],
  },
})
