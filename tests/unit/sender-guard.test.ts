import { afterEach, describe, expect, it } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { isTrustedMainFrameSender, isTrustedSender } from '../../src/main/sender-guard';

const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;

afterEach(() => {
  if (originalRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL;
  } else {
    process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
  }
});

function createSender(url: string, id = 7): {
  sender: WebContents;
  event: IpcMainInvokeEvent;
} {
  const mainFrame = { parent: null };
  const sender = {
    id,
    isDestroyed: () => false,
    getURL: () => url,
    mainFrame,
  } as unknown as WebContents;
  return {
    sender,
    event: {
      sender,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}

describe('sender guard renderer URL boundary', () => {
  it('does not trust the ambient dev URL without the sanitized runtime value', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const { sender, event } = createSender('http://localhost:5173/?role=query');

    expect(isTrustedSender(event, [sender])).toBe(false);
    expect(isTrustedMainFrameSender(event, [sender])).toBe(false);
  });

  it('trusts a matching explicit local dev origin without weakening identity checks', () => {
    const { sender, event } = createSender('http://localhost:5173/?role=query');
    const other = { ...sender, id: 8 } as WebContents;

    expect(isTrustedSender(event, [sender], 'http://localhost:5173/')).toBe(true);
    expect(isTrustedMainFrameSender(event, [sender], 'http://localhost:5173/')).toBe(true);
    expect(isTrustedSender(event, [other], 'http://localhost:5173/')).toBe(false);
  });

  it('rejects child frames even when their WebContents and dev origin match', () => {
    const { sender, event } = createSender('http://127.0.0.1:5173/?role=fox');
    Object.assign(event, { senderFrame: { parent: {} } });

    expect(isTrustedSender(event, [sender], 'http://127.0.0.1:5173/')).toBe(false);
  });
});
