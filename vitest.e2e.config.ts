import { defineConfig } from 'vitest/config'
// The e2e harness (apps/orbrun/test/e2e): the app's own client on crawl built to WebAssembly
// (engine/build.sh). Every file skips itself where no engine is built.
export default defineConfig({
  test: {
    include: ['apps/orbrun/test/e2e/**/*.test.ts'],
    testTimeout: 600_000,
  },
})
