import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
function compiledEntry(name: string) {
  return resolve(dirname(require.resolve(`${name}/package.json`)), 'dist/index.js');
}

export default defineConfig({
  server: {
    fs: {
        allow: [resolve(__dirname, '../..')],
    },
  },
  plugins: [react()],
  assetsInclude: ['**/*.png'],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      // `conditions: ['source']` is for workspace TypeScript. These two also
      // publish a source condition, and antd would otherwise load raw .ts.
      'scroll-into-view-if-needed': compiledEntry('scroll-into-view-if-needed'),
      'compute-scroll-into-view': compiledEntry('compute-scroll-into-view'),
    },
    conditions: ['source'],
  },
  ssr: {
    noExternal: ['@customer-agent/retrieval-core', 'antd', 'scroll-into-view-if-needed', 'compute-scroll-into-view'],
    resolve: {
      conditions: ['source'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    fileParallelism: false,
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['antd', 'antd/locale/zh_CN', 'scroll-into-view-if-needed', 'compute-scroll-into-view'],
        },
      },
    },
  },
});
