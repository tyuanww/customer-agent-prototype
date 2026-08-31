import { app, nativeImage, type NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import {
  appIconCandidates,
  type AppIconLocation,
} from './app-icon-paths';
import type { ShutdownFence } from './shutdown-fence';

export {
  appIconCandidates,
  packagedAppIconCandidates,
  unpackagedAppIconCandidates,
  type AppIconLocation,
} from './app-icon-paths';

export type AppIdentitySnapshot = {
  platform: NodeJS.Platform;
  packaged: boolean;
  dockVisible: boolean | null;
  dockIconEmpty: boolean | null;
};

function identityLocation(): AppIconLocation {
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  };
}

export function resolveAppIconPath(location: AppIconLocation = identityLocation()): string | null {
  return appIconCandidates(location).find((candidate) => existsSync(candidate)) ?? null;
}

export function loadAppNativeImage(location: AppIconLocation = identityLocation()): NativeImage | null {
  const iconPath = resolveAppIconPath(location);
  if (!iconPath) {
    return null;
  }
  try {
    const image = nativeImage.createFromPath(iconPath);
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

export function loadBrandNativeImage(location: AppIconLocation = identityLocation()): NativeImage | null {
  return loadAppNativeImage(location);
}

export async function applyApplicationIdentity(
  fence?: ShutdownFence | { isShuttingDown(): boolean },
): Promise<AppIdentitySnapshot> {
  const location = identityLocation();
  const snapshot: AppIdentitySnapshot = {
    platform: process.platform,
    packaged: location.isPackaged,
    dockVisible: null,
    dockIconEmpty: null,
  };

  if (process.platform !== 'darwin' || fence?.isShuttingDown()) {
    return snapshot;
  }

  try {
    app.setActivationPolicy?.('regular');
  } catch {
    // Older Electron builds may not expose setActivationPolicy.
  }

  if (fence?.isShuttingDown()) {
    return snapshot;
  }

  const image = loadAppNativeImage(location);
  if (image && !location.isPackaged) {
    app.dock?.setIcon(image);
  }
  snapshot.dockIconEmpty = image ? image.isEmpty() : true;

  const dock = app.dock;
  if (dock && !dock.isVisible()) {
    if (fence?.isShuttingDown()) {
      return snapshot;
    }
    try {
      await dock.show();
    } catch (error) {
      if (!fence?.isShuttingDown()) {
        throw error;
      }
      return snapshot;
    }
  }
  if (fence?.isShuttingDown()) {
    return snapshot;
  }
  snapshot.dockVisible = dock ? dock.isVisible() : null;
  return snapshot;
}
