import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkArchitecture, formatReport } from './architecture-boundary-check.mjs';

const script = fileURLToPath(new URL('./architecture-boundary-check.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(script), '..');

const desktopTsconfig = `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@renderer/*": ["src/renderer/*"]
    }
  }
}
`;

function withProject(files, run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'architecture-boundary-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolute = path.join(root, relativePath);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectClean(root) {
  const result = checkArchitecture({ projectRoot: root });
  assert.deepEqual(result.violations, [], formatReport(result));
}

function expectRule(root, rule, fileFragment) {
  const result = checkArchitecture({ projectRoot: root });
  const match = result.violations.find((entry) => entry.rule === rule && entry.file.includes(fileFragment));
  assert.ok(match, formatReport(result));
  assert.equal(match.rule, rule);
  assert.ok(match.line >= 1);
  assert.match(match.detail, /\S/u);
  assert.match(match.fix, /\S/u);
  return match;
}

test('renderer may import React, @shared, and contract types', () => {
  withProject({
    'apps/desktop/tsconfig.json': desktopTsconfig,
    'apps/desktop/src/renderer/View.tsx': `
      import { useState } from 'react';
      import { sessionDisplayName } from '@shared/product-session';
      import type { components } from '@customer-agent/contracts';
      // import { ipcRenderer } from 'electron';
      const note = "from 'electron'";
      export const view = useState(sessionDisplayName);
      export type Contract = components;
      void note;
    `,
  }, expectClean);
});

test('renderer import of electron fails with file, rule, and fix', () => {
  withProject({
    'apps/desktop/src/renderer/leak.ts': "import { ipcRenderer } from 'electron';\nexport const bridge = ipcRenderer;\n",
  }, (root) => {
    const match = expectRule(root, 'renderer-no-privileged-import', 'apps/desktop/src/renderer/leak.ts');
    assert.match(match.detail, /electron/u);
    assert.match(match.fix, /preload/u);
  });
});

test('renderer import of main, preload, and database fails', () => {
  withProject({
    'apps/desktop/tsconfig.json': desktopTsconfig,
    'apps/desktop/src/renderer/leak.ts': `
      import { app } from '../main/main';
      import { bridge } from '../preload/index';
      import { app as aliased } from '@shared/../main/overlay-controller';
      import pg from 'pg';
      import { migrate } from '@customer-agent/database';
      import { run } from '../../../../packages/database/src/index.ts';
      export const values = [app, bridge, aliased, pg, migrate, run];
    `,
  }, (root) => {
    const result = checkArchitecture({ projectRoot: root });
    const details = result.violations.map((entry) => entry.detail).join('\n');
    assert.ok(result.violations.every((entry) => entry.rule === 'renderer-no-privileged-import'), formatReport(result));
    assert.match(details, /src\/main\/main/u);
    assert.match(details, /src\/preload\/index/u);
    assert.match(details, /overlay-controller/u);
    assert.match(details, /"pg"/u);
    assert.match(details, /@customer-agent\/database/u);
    assert.match(details, /packages\/database/u);
    assert.match(result.violations[0].fix, /数据库/u);
  });
});

test('preload may wrap fixed channels and keep a private channel helper', () => {
  withProject({
    'apps/desktop/src/preload/index.ts': `
      import { contextBridge, ipcRenderer } from 'electron';
      const GET_CONTEXT = 'overlay:get-window-context';
      const OPS_RETRIEVAL = 'dashboard:ops-retrieval';
      async function invokeFixed() {
        return ipcRenderer.invoke(GET_CONTEXT);
      }
      async function invokeOps(channel, ...args) {
        return ipcRenderer.invoke(channel, ...args);
      }
      ipcRenderer.on(GET_CONTEXT, () => {});
      // contextBridge.exposeInMainWorld('electron', { invoke(channel) { return ipcRenderer.invoke(channel); } });
      const api = {
        getWindowContext() {
          return invokeFixed();
        },
        retrieval(window) {
          return invokeOps(OPS_RETRIEVAL, window);
        },
        onOverlayCommand(handler) {
          return () => handler;
        },
      };
      contextBridge.exposeInMainWorld('customerAgent', api);
    `,
  }, expectClean);
});

test('preload generic send/on/invoke fails', () => {
  withProject({
    'apps/desktop/src/preload/bridge.ts': `
      import { contextBridge, ipcRenderer } from 'electron';
      contextBridge.exposeInMainWorld('bridge', {
        invoke(channel, ...args) {
          return ipcRenderer.invoke(channel, ...args);
        },
        on(channel, listener) {
          return ipcRenderer.on(channel, listener);
        },
        send(channel, payload) {
          return ipcRenderer.send(channel, payload);
        },
      });
    `,
  }, (root) => {
    const match = expectRule(root, 'preload-no-generic-ipc', 'apps/desktop/src/preload/bridge.ts');
    assert.match(match.detail, /invoke|on|send/u);
    assert.match(match.fix, /channel/u);
  });
});

test('preload exposing a helper that accepts the caller channel fails', () => {
  withProject({
    'apps/desktop/src/preload/bridge.ts': `
      import { contextBridge, ipcRenderer } from 'electron';
      function forward(channel, ...args) {
        return ipcRenderer.invoke(channel, ...args);
      }
      const api = {
        search(channel) {
          return forward(channel);
        },
      };
      contextBridge.exposeInMainWorld('customerAgent', api);
    `,
  }, (root) => {
    const match = expectRule(root, 'preload-no-generic-ipc', 'apps/desktop/src/preload/bridge.ts');
    assert.match(match.detail, /search/u);
    assert.match(match.fix, /窄方法/u);
  });
});

test('packages may import node builtins and root scripts', () => {
  withProject({
    'packages/contracts/src/helper.ts': 'export const helper = "ok";\n',
    'packages/contracts/src/index.ts': `
      import { createHash } from 'node:crypto';
      import { helper } from './helper.ts';
      export const value = createHash('sha256').update(helper).digest('hex');
    `,
    'packages/contracts/scripts/generate.mjs': "import { lock } from '../../../scripts/customer-agent-contract-set.mjs';\nexport const ownership = lock;\n",
  }, expectClean);
});

test('packages importing an app fails', () => {
  withProject({
    'packages/contracts/src/leak.ts': "import { startApi } from '../../../apps/api/src/server.ts';\nexport const api = startApi;\n",
  }, (root) => {
    const match = expectRule(root, 'packages-no-app-dependency', 'packages/contracts/src/leak.ts');
    assert.match(match.detail, /apps\/api/u);
    assert.match(match.fix, /packages/u);
  });
});

test('packages package.json dependency on an app fails', () => {
  withProject({
    'apps/api/package.json': '{ "name": "@customer-agent/api" }\n',
    'packages/contracts/package.json': `{
      "name": "@customer-agent/contracts",
      "dependencies": { "@customer-agent/api": "workspace:*" }
    }
    `,
  }, (root) => {
    const match = expectRule(root, 'packages-no-app-dependency', 'packages/contracts/package.json');
    assert.match(match.detail, /@customer-agent\/api/u);
  });
});

test('api may import contracts and the D5 desktop adapter seam', () => {
  withProject({
    'apps/desktop/package.json': '{ "name": "@customer-agent/desktop" }\n',
    'apps/api/src/server.ts': "import { health } from '@customer-agent/contracts';\nexport const ready = health;\n",
    'apps/api/tests/backend-runtime.e2e.test.ts': `
      export async function connectDesktopAdapter() {
        const main = new URL('../../desktop/src/main/', import.meta.url);
        return Promise.all([
          import(new URL('product-http.ts', main).href),
          import(new URL('product-session.ts', main).href),
          import(new URL('product-announce.ts', main).href),
          import(new URL('product-search.ts', main).href),
        ]);
      }
    `,
  }, expectClean);
});

test('api source importing desktop fails', () => {
  withProject({
    'apps/api/src/leak.ts': "import { ProductSession } from '../../desktop/src/main/product-session.ts';\nexport const Session = ProductSession;\n",
  }, (root) => {
    const match = expectRule(root, 'api-no-desktop-dependency', 'apps/api/src/leak.ts');
    assert.match(match.detail, /product-session/u);
    assert.match(match.fix, /loopback/u);
  });
});

test('D5 e2e file still fails when it loads a desktop module outside the four adapters', () => {
  withProject({
    'apps/api/tests/backend-runtime.e2e.test.ts': `
      export async function connectDesktopAdapter() {
        const main = new URL('../../desktop/src/main/', import.meta.url);
        return import(new URL('overlay-controller.ts', main).href);
      }
    `,
  }, (root) => {
    const match = expectRule(root, 'api-no-desktop-dependency', 'backend-runtime.e2e.test.ts');
    assert.match(match.detail, /overlay-controller/u);
  });
});

test('api package.json dependency on desktop fails', () => {
  withProject({
    'apps/desktop/package.json': '{ "name": "@customer-agent/desktop" }\n',
    'apps/api/package.json': `{
      "name": "@customer-agent/api",
      "dependencies": { "@customer-agent/desktop": "workspace:*" }
    }
    `,
  }, (root) => {
    const match = expectRule(root, 'api-no-desktop-dependency', 'apps/api/package.json');
    assert.match(match.detail, /@customer-agent\/desktop/u);
  });
});

test('shared may import contract types, node:crypto, and a document parameter', () => {
  withProject({
    'apps/desktop/src/shared/score.ts': `
      import type { components } from '@customer-agent/contracts';
      import { createHash } from 'node:crypto';
      export function score(document: string): number {
        return document.length + createHash('sha256').update(document).digest().length;
      }
      export type Contract = components;
    `,
  }, expectClean);
});

test('shared import of React or Electron fails', () => {
  withProject({
    'apps/desktop/src/shared/view.ts': "import { createElement } from 'react';\nimport { ipcRenderer } from 'electron';\nexport const view = createElement('div');\nvoid ipcRenderer;\n",
  }, (root) => {
    const result = checkArchitecture({ projectRoot: root });
    const details = result.violations.map((entry) => entry.detail).join('\n');
    assert.ok(result.violations.every((entry) => entry.rule === 'shared-no-ui-runtime'), formatReport(result));
    assert.match(details, /react/u);
    assert.match(details, /electron/u);
    assert.match(result.violations[0].fix, /纯函数/u);
  });
});

test('shared DOM use fails while a document parameter stays allowed', () => {
  withProject({
    'apps/desktop/src/shared/dom.ts': `
      export function readTitle(document: string): string {
        return document;
      }
      export const title = document.body.textContent;
    `,
  }, (root) => {
    const match = expectRule(root, 'shared-no-ui-runtime', 'apps/desktop/src/shared/dom.ts');
    assert.match(match.detail, /DOM/u);
  });
});

test('the current repository has no architecture violations', () => {
  const result = checkArchitecture({ projectRoot: repositoryRoot });
  assert.equal(result.violations.length, 0, formatReport(result));
  assert.ok(result.scannedFileCount > 0);
});

test('cli exits non-zero and names the file, rule, and fix', () => {
  withProject({
    'apps/desktop/src/renderer/leak.ts': "import electron from 'electron';\nexport default electron;\n",
  }, (root) => {
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/desktop\/src\/renderer\/leak\.ts/u);
    assert.match(result.stderr, /renderer-no-privileged-import/u);
    assert.match(result.stderr, /fix:/u);
    assert.equal(result.stdout, '');
  });
});

test('cli exits 0 on this repository', () => {
  const result = spawnSync(process.execPath, [script, repositoryRoot], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Architecture boundary PASS: \d+ files, 0 violations/u);
});
