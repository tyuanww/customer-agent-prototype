import { defineConfig } from 'vitest/config';

// Nested verification suites start their own Vitest and TypeScript processes.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
