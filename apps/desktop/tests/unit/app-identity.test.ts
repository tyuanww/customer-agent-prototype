import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  APP_ICON_FOX_FILL_MAX,
  APP_ICON_FOX_FILL_MIN,
  APP_ICON_MASTER_RELATIVE_PATH,
  APP_ICON_MASTER_SIZE,
  APP_ICON_PLATE_SIZE,
  ICO_FRAME_SIZES,
} from '../../src/shared/app-icon';
import {
  appIconCandidates,
  packagedAppIconCandidates,
  unpackagedAppIconCandidates,
} from '../../src/main/app-icon-paths';
import { trayIconCandidates } from '../../src/main/desktop-menu-model';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(root, '../..');
const packageBuild = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  build: { win: { extraResources: Array<{ from: string; to: string }> } };
}).build;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function generateMaster(destination: string): string {
  execFileSync(process.execPath, [
    path.join(root, 'scripts/generate-app-icons.mjs'),
    '--master',
    destination,
  ], { cwd: root, stdio: 'pipe' });
  return destination;
}

function decodePngRgba(buffer: Buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    source += 1;
    inflated.copy(pixels, y * width * 4, source, source + width * 4);
    source += width * 4;
  }
  return { width, height, pixels };
}

function parseIcoFrames(buffer: Buffer) {
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const listedWidth = buffer.readUInt8(entry);
    const listedHeight = buffer.readUInt8(entry + 1);
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    const png = buffer.subarray(offset, offset + bytes);
    return {
      listedWidth: listedWidth === 0 ? 256 : listedWidth,
      listedHeight: listedHeight === 0 ? 256 : listedHeight,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    };
  });
}

function foxFill(pixels: Buffer, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const a = pixels[index + 3];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (a > 80 && chroma > 35) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return Math.max(maxX - minX + 1, maxY - minY + 1) / APP_ICON_PLATE_SIZE;
}

describe('brand icon assets', () => {
  it('keeps a 1024 app-icon master that is not the transparent fox-head', () => {
    const foxPath = path.join(root, 'fox-head.png');
    const masterPath = path.join(root, APP_ICON_MASTER_RELATIVE_PATH);
    expect(existsSync(foxPath)).toBe(true);
    expect(existsSync(masterPath)).toBe(true);

    const fox = readFileSync(foxPath);
    const master = readFileSync(masterPath);
    expect(createHash('sha256').update(fox).digest('hex')).not.toBe(
      createHash('sha256').update(master).digest('hex'),
    );

    const decoded = decodePngRgba(master);
    expect(decoded.width).toBe(APP_ICON_MASTER_SIZE);
    expect(decoded.height).toBe(APP_ICON_MASTER_SIZE);
    const corners = [
      [0, 0],
      [decoded.width - 1, 0],
      [0, decoded.height - 1],
      [decoded.width - 1, decoded.height - 1],
    ].map(([x, y]) => decoded.pixels[(y * decoded.width + x) * 4 + 3]);
    expect(corners).toEqual([0, 0, 0, 0]);
    for (const y of [96, APP_ICON_MASTER_SIZE - 96]) {
      const index = (y * decoded.width + Math.round(decoded.width / 2)) * 4;
      expect(decoded.pixels[index + 3]).toBeGreaterThan(200);
      expect(decoded.pixels[index]).toBeGreaterThan(235);
      expect(decoded.pixels[index + 1]).toBeGreaterThan(235);
      expect(decoded.pixels[index + 2]).toBeGreaterThan(235);
    }
    const fill = foxFill(decoded.pixels, decoded.width, decoded.height);
    expect(fill).toBeGreaterThanOrEqual(APP_ICON_FOX_FILL_MIN);
    expect(fill).toBeLessThanOrEqual(APP_ICON_FOX_FILL_MAX);

    const temp = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-master-test-'));
    try {
      const generatedPath = generateMaster(path.join(temp, 'app-icon.png'));
      const generated = decodePngRgba(readFileSync(generatedPath));
      expect(generated.width).toBe(decoded.width);
      expect(generated.height).toBe(decoded.height);
      expect(generated.pixels.equals(decoded.pixels)).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('generates a real multi-size ICO from the app icon master', () => {
    const masterPath = path.join(root, APP_ICON_MASTER_RELATIVE_PATH);
    const temp = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-icon-test-'));
    const iconResource = packageBuild.win.extraResources.find(
      (resource) => resource.from === 'build/icon.ico',
    );
    expect(iconResource).toEqual({ from: 'build/icon.ico', to: 'icon.ico' });
    if (!iconResource) {
      throw new Error('Windows app icon is missing from build.win.extraResources');
    }
    const resourcesPath = path.join(temp, 'resources');
    const generatedIcoPath = path.join(temp, iconResource.from);
    const packagedIcoPath = path.join(resourcesPath, iconResource.to);
    try {
      mkdirSync(path.dirname(generatedIcoPath), { recursive: true });
      mkdirSync(resourcesPath, { recursive: true });
      execFileSync(process.execPath, [
        path.join(root, 'scripts/generate-app-icons.mjs'),
        '--ico',
        masterPath,
        generatedIcoPath,
      ], { cwd: root, stdio: 'pipe' });
      copyFileSync(generatedIcoPath, packagedIcoPath);
      const frames = parseIcoFrames(readFileSync(packagedIcoPath));
      expect(frames.map((frame) => frame.width)).toEqual([...ICO_FRAME_SIZES]);
      for (const frame of frames) {
        expect(frame.width).toBe(frame.listedWidth);
        expect(frame.height).toBe(frame.listedHeight);
      }

      const packagedWindowsLocation = {
        isPackaged: true,
        appPath: path.join(resourcesPath, 'app.asar'),
        resourcesPath,
      };
      const packagedCandidates = packagedAppIconCandidates(packagedWindowsLocation, 'win32');
      expect(packagedCandidates[0]).toBe(packagedIcoPath);
      expect(packagedCandidates.find((candidate) => existsSync(candidate))).toBe(packagedIcoPath);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    const generator = readFileSync(path.join(root, 'scripts/generate-app-icons.mjs'), 'utf8');
    const macIcon = readFileSync(path.join(root, 'scripts/generate-mac-icon.sh'), 'utf8');
    const gitignore = readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');
    expect(generator).toContain('ICO_FRAME_SIZES');
    expect(generator).toContain('assets/app-icon.png');
    expect(generator).not.toMatch(/https?:\/\//);
    expect(macIcon).toContain('assets/app-icon.png');
    expect(macIcon).not.toContain('fox-head.png');
    expect(gitignore).toContain('build/icon.icns');
    expect(gitignore).toContain('build/icon.png');
    expect(gitignore).toContain('build/icon.ico');
    expect(gitignore).not.toContain(APP_ICON_MASTER_RELATIVE_PATH);
  });

  it('splits Tray fox-head candidates from App/Dock master candidates', () => {
    const devLocation = {
      isPackaged: false,
      appPath: '/repo/customer-agent-prototype/apps/desktop/out/main',
      resourcesPath: '/Electron.app/Contents/Resources',
    };
    const packagedMac = {
      isPackaged: true,
      appPath: '/Applications/Demo.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/Demo.app/Contents/Resources',
    };
    expect(unpackagedAppIconCandidates(devLocation)).toEqual([
      path.join(devLocation.appPath, APP_ICON_MASTER_RELATIVE_PATH),
      path.join('/repo/customer-agent-prototype/apps/desktop', APP_ICON_MASTER_RELATIVE_PATH),
    ]);
    expect(appIconCandidates(devLocation).join('\n')).not.toContain('fox-head.png');
    expect(appIconCandidates(devLocation).join('\n')).not.toContain('build/icon.png');
    expect(trayIconCandidates(devLocation)).toEqual([
      path.join(devLocation.appPath, 'fox-head.png'),
      '/repo/customer-agent-prototype/apps/desktop/fox-head.png',
    ]);
    expect(trayIconCandidates(devLocation).join('\n')).not.toContain('app-icon.png');
    const packagedMacCandidates = packagedAppIconCandidates(packagedMac, 'darwin');
    expect(packagedMacCandidates.join('\n')).not.toContain('fox-head.png');
    expect(packagedMacCandidates).toEqual([
      '/Applications/Demo.app/Contents/Resources/icon.icns',
    ]);
    expect(packagedMacCandidates.join('\n')).not.toContain('electron.icns');

    const identity = readFileSync(path.join(root, 'src/main/app-identity.ts'), 'utf8');
    expect(identity).toContain('loadAppNativeImage');
    expect(identity).toContain('if (dock && !dock.isVisible())');
    expect(identity).toContain('await dock.show()');
    expect(identity.indexOf('app.dock?.setIcon')).toBeLessThan(identity.indexOf('await dock.show()'));
    expect(identity).not.toContain('app.dock.hide');
    expect(identity).toContain('appIconCandidates(location)');
    expect(identity).not.toContain('return trayIconCandidates');
  });
});
