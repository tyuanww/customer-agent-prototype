import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('renderer runtime security wiring', () => {
  it('uses one sanitized dev URL for CSP, loading, and IPC sender trust', () => {
    const main = source('src/main/main.ts');
    const controller = source('src/main/overlay-controller.ts');
    const loader = source('src/main/overlay-renderer-loader.ts');
    const senderGuard = source('src/main/sender-guard.ts');
    const overlayIpc = source('src/main/overlay-ipc.ts');
    const clipboardIpc = source('src/main/clipboard-ipc.ts');

    expect(main).toContain('resolveRendererDevServerUrl(\n      app.isPackaged,');
    expect(main).toContain('applyContentSecurityPolicy(rendererDevServerUrl)');
    expect(main).toContain('rendererDevServerUrl,');
    expect(main).toContain('() => controller?.rendererDevServerUrl');
    expect(controller).toContain('this.rendererDevServerUrl = options.rendererDevServerUrl');
    expect(controller).toContain("loadRenderer(this.fox, 'fox', this.rendererDevServerUrl");
    expect(overlayIpc).toContain('controller.rendererDevServerUrl');
    expect(clipboardIpc).toContain('getDevServerUrl()');
    expect(loader).not.toContain('ELECTRON_RENDERER_URL');
    expect(senderGuard).not.toContain('ELECTRON_RENDERER_URL');
  });
});
