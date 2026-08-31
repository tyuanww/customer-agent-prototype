export const DEFAULT_GLOBAL_ACCELERATOR = 'CommandOrControl+Shift+Space';

export type ShortcutBindResult =
  | { ok: true; accelerator: string }
  | { ok: false; accelerator: string; message: string };

export function formatAcceleratorLabel(
  accelerator: string,
  platform: string = 'win32',
): string {
  const isMac = platform === 'darwin';
  return accelerator
    .replaceAll('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replaceAll('Command', isMac ? '⌘' : 'Win')
    .replaceAll('Control', 'Ctrl')
    .replaceAll('Shift', isMac ? '⇧' : 'Shift')
    .replaceAll('Space', isMac ? '空格' : 'Space')
    .replaceAll('+', isMac ? '' : '+');
}

export function describeShortcutFailure(accelerator: string, platform: string = 'win32'): string {
  const label = formatAcceleratorLabel(accelerator, platform);
  return `全局快捷键 ${label} 注册失败，可能被系统或其他软件占用。请点击狐狸头打开查询窗。`;
}

export function bindGlobalShortcut(
  register: (accelerator: string) => boolean,
  accelerator: string = DEFAULT_GLOBAL_ACCELERATOR,
  platform: string = 'win32',
): ShortcutBindResult {
  const ok = register(accelerator);
  if (ok) {
    return { ok: true, accelerator };
  }
  return {
    ok: false,
    accelerator,
    message: describeShortcutFailure(accelerator, platform),
  };
}
