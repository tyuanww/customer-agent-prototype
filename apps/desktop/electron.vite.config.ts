import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { stripCrossOriginAttributes } from './src/shared/file-renderer-html';

export default defineConfig({
  main: {
    // Workspace contracts must be inlined. Windows smoke launches out/main
    // without nested apps/desktop/node_modules/@customer-agent/*, and the
    // unsigned package only ships out/** plus package.json.
    plugins: [externalizeDepsPlugin({ exclude: ['@customer-agent/contracts'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          login: resolve(__dirname, 'src/preload/login.ts'),
          sop: resolve(__dirname, 'src/preload/sop.ts'),
          dashboard: resolve(__dirname, 'src/preload/dashboard.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: {
      fs: {
        allow: [resolve(__dirname)],
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    plugins: [
      react(),
      {
        name: 'strip-crossorigin-for-file-renderer',
        transformIndexHtml(html: string) {
          return stripCrossOriginAttributes(html);
        },
      },
    ],
  },
});
