import { BrowserWindow, nativeImage } from 'electron';
import { lockRendererWindow } from './window-security';

const DECODER_DOCUMENT = 'data:text/html,' + encodeURIComponent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">',
);

/** Decode verified image bytes in Main. nativeImage does not support GIF, so
 * GIF uses Chromium in an isolated, hidden document with no application API.
 * The media owner's cancellation and a bounded deadline destroy that document. */
export async function decodeSopImage(bytes: Buffer, mime: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  if (mime !== 'image/gif') return !nativeImage.createFromBuffer(bytes).isEmpty();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  lockRendererWindow(window);
  let cancel: () => void = () => {};
  const cancelled = new Promise<boolean>(resolve => {
    cancel = () => {
      resolve(false);
      if (!window.isDestroyed()) window.destroy();
    };
  });
  const deadline = setTimeout(cancel, 5000);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const decode = async (): Promise<boolean> => {
      await window.loadURL(DECODER_DOCUMENT);
      if (signal.aborted || window.isDestroyed()) return false;
      const result: unknown = await window.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(`data:image/gif;base64,${bytes.toString('base64')}`)};
        await image.decode();
        return image.naturalWidth > 0 && image.naturalHeight > 0;
      })()`);
      return result === true;
    };
    return await Promise.race([decode(), cancelled]);
  } catch {
    // Decode/load failure shares the existing visible media-unavailable recovery.
    return false;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
    if (!window.isDestroyed()) window.destroy();
  }
}
