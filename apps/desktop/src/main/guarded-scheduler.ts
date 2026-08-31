export class GuardedScheduler {
  private disposed = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  get isDisposed(): boolean {
    return this.disposed;
  }

  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> | null {
    if (this.disposed) {
      return null;
    }
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (this.disposed) {
        return;
      }
      callback();
    }, delayMs);
    this.timers.add(handle);
    return handle;
  }

  clear(handle: ReturnType<typeof setTimeout> | null): void {
    if (handle === null) {
      return;
    }
    clearTimeout(handle);
    this.timers.delete(handle);
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.timers) {
      clearTimeout(handle);
    }
    this.timers.clear();
  }
}
