import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron';
import {
  buildSopClipboardPayload,
  projectSopPipeline,
  startSopPipelineSession,
  writeSopClipboard,
  type SopPipelineFlow,
} from '../../src/shared/sop-pipeline.js';

const flow: SopPipelineFlow = {
  sopId: 'synthetic-ipc-sop',
  title: '合成 IPC 流程',
  entryStepId: 'step1',
  steps: [
    { stepId: 'step1', kind: 'instruction', sequence: 1, text: '真实 IPC 图文话术', media: ['med-a'] },
  ],
  branches: [],
};

const session = startSopPipelineSession(
  flow,
  {
    releaseId: 'rel-synthetic-ipc',
    sessionEpoch: 1,
    revoked: false,
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  [{ mediaId: 'med-a', mime: 'image/png' }],
);
const projection = projectSopPipeline(session, 1);
const payload = buildSopClipboardPayload(session, [{
  mediaId: 'med-a',
  mime: 'image/png',
  bytes: readFileSync('fox-head.png'),
}]);

async function run(): Promise<void> {
  await app.whenReady();
  process.stderr.write('SOP_IPC_STAGE=ready\n');
  clipboard.clear();
  let copyCalls = 0;
  ipcMain.handle('sop-window:copy-current', () => {
    copyCalls += 1;
    writeSopClipboard(
      { write: (data) => clipboard.write(data as Parameters<typeof clipboard.write>[0]) },
      (bytes) => {
        const image = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
        return image.isEmpty() ? null : image;
      },
      payload,
    );
    return { ok: true };
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(process.cwd(), 'out/preload/sop.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL('data:text/html,<html><body></body></html>');
  process.stderr.write('SOP_IPC_STAGE=loaded\n');
  await window.webContents.executeJavaScript(`
    (() => {
      window.sopWindow.onProjection((projection) => {
        window.__sopPipelineProjection = projection;
      });
      return true;
    })()
  `);
  process.stderr.write('SOP_IPC_STAGE=listening\n');
  window.webContents.send('sop-window:projection', projection);
  process.stderr.write('SOP_IPC_STAGE=sent\n');
  const received = await window.webContents.executeJavaScript('window.__sopPipelineProjection');
  process.stderr.write('SOP_IPC_STAGE=received\n');
  const copyResult = await window.webContents.executeJavaScript('window.sopWindow.copyCurrent()');
  process.stderr.write('SOP_IPC_STAGE=copied\n');
  const result = {
    projectionAccepted: received?.projectionVersion === 'sop-pipeline-v1',
    copyResult,
    copyCalls,
    text: clipboard.readText(),
    htmlHasImage: /<img\b/iu.test(clipboard.readHTML()),
    imageEmpty: clipboard.readImage().isEmpty(),
  };
  process.stdout.write(`SOP_IPC_RESULT=${JSON.stringify(result)}\n`);
  window.destroy();
  app.quit();
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  app.exit(1);
});
