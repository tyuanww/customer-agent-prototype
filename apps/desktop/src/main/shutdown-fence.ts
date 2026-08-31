export type ShutdownFence = {
  begin(): void;
  isShuttingDown(): boolean;
};

export function createShutdownFence(): ShutdownFence {
  let shuttingDown = false;
  return {
    begin() {
      shuttingDown = true;
    },
    isShuttingDown() {
      return shuttingDown;
    },
  };
}

export function isInactiveOverlay(
  disposed: boolean,
  fence?: { isShuttingDown(): boolean } | null,
): boolean {
  return disposed || Boolean(fence?.isShuttingDown());
}

export function isUsableWindow<T extends { isDestroyed(): boolean }>(
  win: T | null | undefined,
  disposed = false,
  fence?: { isShuttingDown(): boolean } | null,
): win is T {
  return win != null && !win.isDestroyed() && !isInactiveOverlay(disposed, fence);
}
