import { execFileSync } from 'node:child_process';
import path from 'node:path';

const UNUSED_MAC_KEYS = [
  'NSAppTransportSecurity',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const infoPlist = path.join(context.appOutDir, appName, 'Contents', 'Info.plist');
  for (const key of UNUSED_MAC_KEYS) {
    try {
      execFileSync('/usr/bin/plutil', ['-remove', key, infoPlist], {
        stdio: 'ignore',
      });
    } catch {
      // Electron versions differ in their default plist. Missing keys already
      // satisfy this least-privilege hook; the post-package verifier checks the
      // final invariant independently.
    }
  }
}

export default afterPack;
