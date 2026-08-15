export type CopyTextResult =
  | { ok: true }
  | { ok: false; message: string };

export type PlatformName = 'darwin' | 'win32' | 'linux' | string;

export type PlatformInfo = {
  platform: PlatformName;
};
