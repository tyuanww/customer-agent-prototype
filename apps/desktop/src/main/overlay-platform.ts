import { app, systemPreferences, type BrowserWindow } from 'electron';
import type { GuardedScheduler } from './guarded-scheduler';

const YIELD_SHOW_DELAY_MS = 34;

export type IdleFoxYield = {
  /** Rechecked after one frame. False skips the delayed show. */
  canShow: () => boolean;
  /** Called only after the idle fox is shown again. */
  onShown: (fox: BrowserWindow) => void;
};

/**
 * OS policy for overlay focus, palette yield, and transparent-window shadows.
 * OverlayController still decides when a handoff, dismiss, or focus retry
 * happens. This module only hides how the current OS performs that decision.
 */
export class OverlayPlatform {
  private yieldGeneration = 0;
  private yieldShowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly scheduler: GuardedScheduler) {}

  /** macOS caches a stale shadow on the first show of a transparent window. */
  refreshTransparentShadow(win: BrowserWindow): void {
    if (process.platform !== 'darwin') {
      return;
    }
    win.invalidateShadow();
  }

  prefersReducedMotion(): boolean {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return false;
    }
    try {
      return systemPreferences.getAnimationSettings().prefersReducedMotion;
    } catch {
      return false;
    }
  }

  focusQuery(query: BrowserWindow): void {
    // macOS Query is a non-activating panel: key focus without making this
    // process frontmost. Windows/Linux Query is a normal always-on-top window
    // and still needs app.focus() (without steal) so the palette can type.
    if (process.platform !== 'darwin') {
      try {
        app.focus();
      } catch {
        // Some Linux window managers do not support explicit application focus.
      }
    }
    query.focus();
    query.webContents.focus();
  }

  /**
   * Return the previous app to the foreground, then show the idle fox without
   * making it the key window. Returns false on platforms that have no yield
   * primitive; the caller keeps the palette on screen instead.
   */
  yieldPreviousApp(fox: BrowserWindow, yieldPlan: IdleFoxYield): boolean {
    if (process.platform === 'darwin') {
      this.yieldDarwinPalette(fox, yieldPlan);
      return true;
    }
    if (process.platform === 'win32') {
      this.yieldWindowsForeground(fox, yieldPlan);
      return true;
    }
    return false;
  }

  private yieldDarwinPalette(fox: BrowserWindow, yieldPlan: IdleFoxYield): void {
    const generation = ++this.yieldGeneration;
    try {
      app.hide();
    } catch {
      // hide() can throw if the Dock policy is already accessory.
    }
    this.scheduleIdleFoxShow(fox, generation, yieldPlan);
  }

  /** Hide fox one frame so Windows can activate 千牛, then show without stealing. */
  private yieldWindowsForeground(fox: BrowserWindow, yieldPlan: IdleFoxYield): void {
    const generation = ++this.yieldGeneration;
    if (typeof fox.blur === 'function') {
      fox.blur();
    }
    if (fox.isVisible()) {
      fox.hide();
    }
    this.scheduleIdleFoxShow(fox, generation, yieldPlan);
  }

  private scheduleIdleFoxShow(
    fox: BrowserWindow,
    generation: number,
    yieldPlan: IdleFoxYield,
  ): void {
    this.clearYieldShowTimer();
    this.yieldShowTimer = this.scheduler.schedule(() => {
      this.yieldShowTimer = null;
      if (generation !== this.yieldGeneration || !yieldPlan.canShow()) {
        return;
      }
      fox.showInactive();
      yieldPlan.onShown(fox);
    }, YIELD_SHOW_DELAY_MS);
  }

  cancelYield(): void {
    this.yieldGeneration += 1;
    this.clearYieldShowTimer();
  }

  private clearYieldShowTimer(): void {
    this.scheduler.clear(this.yieldShowTimer);
    this.yieldShowTimer = null;
  }

  restorePalette(fox: BrowserWindow): void {
    // Hide Query only. Hiding the whole app would hide the idle fox and help.
    // A non-activating panel yields IME when it hides; fox stays on screen.
    if (process.platform === 'darwin' && typeof app.isHidden === 'function' && app.isHidden()) {
      try {
        app.show();
      } catch {
        // show() can throw if the Dock policy is accessory.
      }
    }
    fox.showInactive();
  }
}
