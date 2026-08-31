import { join, resolve } from 'node:path';
import { APP_ICON_MASTER_RELATIVE_PATH } from '../shared/app-icon';
import type { TrayIconLocation } from './desktop-menu-model';

export type AppIconLocation = TrayIconLocation;

export function packagedAppIconCandidates(
  location: AppIconLocation,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  if (platform === 'darwin') {
    return [join(location.resourcesPath, 'icon.icns')];
  }
  if (platform === 'win32') {
    return [
      join(location.resourcesPath, 'icon.ico'),
      join(location.appPath, 'build', 'icon.ico'),
    ];
  }
  return [];
}

export function unpackagedAppIconCandidates(location: AppIconLocation): readonly string[] {
  return Array.from(
    new Set([
      join(location.appPath, APP_ICON_MASTER_RELATIVE_PATH),
      resolve(location.appPath, '../..', APP_ICON_MASTER_RELATIVE_PATH),
    ]),
  );
}

export function appIconCandidates(
  location: AppIconLocation,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return location.isPackaged
    ? packagedAppIconCandidates(location, platform)
    : unpackagedAppIconCandidates(location);
}
