import { defineConfig } from 'vitest/config';

// One worker. A full parallel run forks one process per core, and the
// search-decision gates spawn another Vitest plus tsc inside that. On this
// machine that blows the 5s budget without changing the tests.
export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
