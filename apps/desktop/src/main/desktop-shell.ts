import { existsSync } from 'node:fs';
import {
  app,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from 'electron';
import type { OverlayController } from './overlay-controller';
import {
  notifyDashboardOpenFailure,
  runDashboardOpenAttempt,
} from './dashboard-open-failure';
import {
  createApplicationMenuModel,
  createOverlayContextMenuModel,
  createTrayMenuModel,
  trayIconCandidates,
  type DesktopActionId,
  type DesktopMenuEntry,
} from './desktop-menu-model';

type DesktopActions = Readonly<Record<DesktopActionId, () => void>>;

export type DesktopShell = {
  readonly trayAvailable: boolean;
  destroy: () => void;
};

export type DesktopShellOptions = {
  controller: OverlayController;
  quit: () => void;
};

function createActions(options: DesktopShellOptions): DesktopActions {
  return {
    'open-search': () => {
      options.controller.openSearch();
    },
    'open-dashboard': () => {
      void runDashboardOpenAttempt(
        () => options.controller.openDashboard(),
        async (reason) => {
          if (!options.controller.isDisposed()) {
            await notifyDashboardOpenFailure(reason);
          }
        },
      );
    },
    quit: options.quit,
  };
}

function toMenuTemplate(
  entries: readonly DesktopMenuEntry[],
  actions: DesktopActions,
): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    if (entry.type === 'separator') {
      return { type: 'separator' };
    }
    if (entry.type === 'edit') {
      return {
        label: entry.label,
        role: entry.role,
        enabled: entry.enabled,
      };
    }
    return {
      id: entry.id,
      label: entry.label,
      click: actions[entry.id],
    };
  });
}

function installApplicationMenu(actions: DesktopActions): void {
  const template = createApplicationMenuModel(process.platform).map(
    (section): MenuItemConstructorOptions => {
      if (section.type === 'role') {
        return { role: section.role };
      }
      return {
        id: 'customer-agent-menu',
        label: section.label,
        submenu: toMenuTemplate(section.items, actions),
      };
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function contextEditCapabilities(params: ContextMenuParams) {
  if (!params.isEditable) {
    return null;
  }
  return {
    canUndo: params.editFlags.canUndo,
    canRedo: params.editFlags.canRedo,
    canCut: params.editFlags.canCut,
    canCopy: params.editFlags.canCopy,
    canPaste: params.editFlags.canPaste,
    canSelectAll: params.editFlags.canSelectAll,
  };
}

function bindOverlayContextMenus(
  controller: OverlayController,
  actions: DesktopActions,
): () => void {
  const bindings: Array<{
    win: BrowserWindow;
    handler: (event: Electron.Event, params: ContextMenuParams) => void;
  }> = [];

  for (const win of controller.getWindows()) {
    const handler = (_event: Electron.Event, params: ContextMenuParams): void => {
      const menu = Menu.buildFromTemplate(
        toMenuTemplate(createOverlayContextMenuModel(contextEditCapabilities(params)), actions),
      );
      const releaseBlurGuard = controller.beginNativeContextMenu(win);
      try {
        menu.popup({
          window: win,
          frame: params.frame ?? undefined,
          x: Math.round(params.x),
          y: Math.round(params.y),
          sourceType: params.menuSourceType,
          callback: releaseBlurGuard,
        });
      } catch (error) {
        releaseBlurGuard();
        console.warn('[desktop-shell] 原生右键菜单打开失败，已保持现有窗口可用。', error);
      }
    };
    win.webContents.on('context-menu', handler);
    bindings.push({ win, handler });
  }

  return () => {
    for (const { win, handler } of bindings) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.removeListener('context-menu', handler);
      }
    }
  };
}

function createTray(actions: DesktopActions): Tray | null {
  const iconCandidates = trayIconCandidates({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const iconPath = iconCandidates.find((candidate) => existsSync(candidate));
  if (!iconPath) {
    console.warn(
      `[desktop-shell] Tray 图标不存在，菜单栏入口已降级：${iconCandidates.join(', ')}`,
    );
    return null;
  }

  try {
    const source = nativeImage.createFromPath(iconPath);
    if (source.isEmpty()) {
      console.warn(`[desktop-shell] Tray 图标无法读取，菜单栏入口已降级：${iconPath}`);
      return null;
    }
    const size = process.platform === 'darwin' ? 18 : process.platform === 'win32' ? 20 : 22;
    const trayIcon = source.resize({ width: size, height: size, quality: 'best' });
    if (process.platform === 'darwin') {
      // macOS menu bar artwork is conventionally a Template image so the OS can
      // render the fox silhouette correctly in light, dark and highlighted states.
      trayIcon.setTemplateImage(true);
    }
    const tray = new Tray(trayIcon);
    const menu = Menu.buildFromTemplate(toMenuTemplate(createTrayMenuModel(), actions));
    tray.setToolTip('客服 Agent Demo');

    if (process.platform === 'linux') {
      // AppIndicator does not reliably emit click; assigning the context menu is
      // the supported left/right activation path there.
      tray.setContextMenu(menu);
    } else {
      const showMenu = (): void => {
        if (!tray.isDestroyed()) {
          tray.popUpContextMenu(menu);
        }
      };
      tray.on('click', showMenu);
      tray.on('right-click', showMenu);
    }
    return tray;
  } catch (error) {
    console.warn('[desktop-shell] Tray 创建失败，右键菜单与应用菜单仍可使用。', error);
    return null;
  }
}

export function installDesktopShell(options: DesktopShellOptions): DesktopShell {
  const actions = createActions(options);
  installApplicationMenu(actions);
  const unbindContextMenus = bindOverlayContextMenus(options.controller, actions);
  const tray = createTray(actions);
  let destroyed = false;

  return {
    trayAvailable: tray !== null,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unbindContextMenus();
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
      }
      Menu.setApplicationMenu(null);
    },
  };
}
