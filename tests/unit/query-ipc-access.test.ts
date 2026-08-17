import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canCopyText,
  canReportQueryLayout,
  canReportUiPhase,
  canResizeQueryHeight,
  isTrustedQuerySender,
} from '../../src/shared/query-ipc-access';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const overlayIpc = readFileSync(path.join(root, 'src/main/overlay-ipc.ts'), 'utf8');
const clipboardIpc = readFileSync(path.join(root, 'src/main/clipboard-ipc.ts'), 'utf8');

describe('trusted query IPC access', () => {
  it('allows REPORT_UI_PHASE and COPY_TEXT only from a trusted query sender', () => {
    expect(isTrustedQuerySender({ trusted: true, role: 'query' })).toBe(true);
    expect(canReportUiPhase({ trusted: true, role: 'query' })).toBe(true);
    expect(canCopyText({ trusted: true, role: 'query' })).toBe(true);
    expect(canReportQueryLayout({ trusted: true, role: 'query' })).toBe(true);
    expect(canResizeQueryHeight({ trusted: true, role: 'query' })).toBe(true);
  });

  it('fails closed for fox, dashboard, unknown, or untrusted senders', () => {
    for (const denied of [
      { trusted: true, role: 'fox' as const },
      { trusted: true, role: 'dashboard' as const },
      { trusted: true, role: null },
      { trusted: false, role: 'query' as const },
    ]) {
      expect(canReportUiPhase(denied)).toBe(false);
      expect(canCopyText(denied)).toBe(false);
      expect(canReportQueryLayout(denied)).toBe(false);
      expect(canResizeQueryHeight(denied)).toBe(false);
      expect(isTrustedQuerySender(denied)).toBe(false);
    }
  });

  it('wires the query-only predicates into the REPORT_UI_PHASE and COPY_TEXT handlers', () => {
    expect(overlayIpc).toContain('canReportUiPhase({ trusted, role })');
    expect(overlayIpc).toContain('isTrustedMainFrameSender(');
    expect(overlayIpc).toContain('controller.rendererDevServerUrl');
    expect(overlayIpc).toContain('canReportQueryLayout({ trusted, role })');
    expect(overlayIpc).toContain('canResizeQueryHeight({ trusted, role })');
    expect(overlayIpc).toContain('IPC_CHANNELS.REPORT_UI_PHASE');
    expect(overlayIpc).toContain('IPC_CHANNELS.REPORT_QUERY_LAYOUT');
    expect(overlayIpc).toContain('IPC_CHANNELS.RESIZE_QUERY_HEIGHT');
    expect(clipboardIpc).toContain('canCopyText({ trusted, role })');
    expect(clipboardIpc).toContain('IPC_CHANNELS.COPY_TEXT');
    expect(clipboardIpc).toMatch(
      /IPC_CHANNELS\.GET_PLATFORM[\s\S]*if \(!guard\(event\)\)/,
    );
    expect(overlayIpc).not.toMatch(/OPEN_SEARCH[\s\S]{0,400}canReportUiPhase/);
  });
});
