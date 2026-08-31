export const MAX_COPY_CHARS = 20_000;

export type ClipboardWriteResolution =
  | { ok: true; payload: string }
  | { ok: false; message: string };

export function resolveClipboardWrite(text: unknown): ClipboardWriteResolution {
  if (typeof text !== 'string') {
    return { ok: false, message: '复制内容无效，请重试' };
  }

  if (text.trim().length === 0) {
    return { ok: false, message: '没有可复制的话术内容' };
  }

  if (text.length > MAX_COPY_CHARS) {
    return { ok: false, message: '复制内容过长，请重试较短话术' };
  }

  return { ok: true, payload: text };
}
