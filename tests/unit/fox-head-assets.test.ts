import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function rgbaAt(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const dashboardHeadsetZones = [
  { minX: 360, maxX: 980, minY: 130, maxY: 340 },
  { minX: 60, maxX: 260, minY: 560, maxY: 880 },
  { minX: 930, maxX: 1170, minY: 560, maxY: 880 },
  { minX: 690, maxX: 1110, minY: 740, maxY: 1040 },
];

function isInsideDashboardHeadsetZone(x: number, y: number): boolean {
  return dashboardHeadsetZones.some((zone) => (
    x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY
  ));
}

async function loadGenerators() {
  const icons = await import(pathToFileURL(path.join(root, 'scripts/generate-app-icons.mjs')).href) as {
    APP_ICON_FOX_FILL: number;
    APP_ICON_MASTER_SIZE: number;
    APP_ICON_PLATE_SIZE: number;
    decodePng: (input: Buffer) => { width: number; height: number; pixels: Buffer };
    encodePngRgba: (pixels: Buffer, width: number, height: number) => Buffer;
    generateAppIconMaster: (options?: Record<string, string>) => string;
  };
  const fox = await import(pathToFileURL(path.join(root, 'scripts/generate-fox-head.mjs')).href) as {
    FOX_EYE_HEX: string;
    FOX_EYE_RGBA: number[];
    FOX_EYE_SAMPLE: { x: number; y: number };
    FOX_APPROVED_SEMANTIC_COUNTS: { faceCore: number; eyeCore: number };
    FOX_FACE_HEX: string;
    FOX_FACE_RGBA: number[];
    FOX_FACE_SAMPLE: { x: number; y: number };
    FOX_HEAD_MASTER_RELATIVE_PATH: string;
    FOX_HEAD_MASTER_SIZE: number;
    analyzeFoxHeadRaster: (
      pixels: Buffer,
      width: number,
      height: number,
    ) => {
      corners: number[][];
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      leftTipY: number;
      rightTipY: number;
      faceCore: number;
      eyeCore: number;
      dualEyeHits: number;
      checkerLike: number;
      whiteGlints: number;
      eye: { cx: number; cy: number };
      stem: { present: boolean; rows: number };
    };
    deriveDarkHeadsetPixels: (pixels: Buffer, width: number, height: number) => Buffer;
    buildCanonicalMasterFromApproved: (sourcePath: string, destinationPath: string) => string;
    writeFoxHeadAssets: (options?: Record<string, unknown>) => {
      masterPath: string;
      sharedPath: string;
      darkPath: string;
    };
  };
  return { ...icons, ...fox };
}

describe('fox head brand assets', () => {
  it('keeps a raster canonical master and does not ship the rejected SVG trace', async () => {
    const { FOX_HEAD_MASTER_RELATIVE_PATH, FOX_FACE_HEX, FOX_EYE_HEX } = await loadGenerators();
    expect(FOX_HEAD_MASTER_RELATIVE_PATH).toBe('assets/fox-head-master.png');
    expect(existsSync(path.join(root, FOX_HEAD_MASTER_RELATIVE_PATH))).toBe(true);
    expect(existsSync(path.join(root, 'assets/fox-head-master.svg'))).toBe(false);
    expect(FOX_FACE_HEX).toBe('#F9D6C5');
    expect(FOX_EYE_HEX).toBe('#A45C4A');
    const generator = readFileSync(path.join(root, 'scripts/generate-fox-head.mjs'), 'utf8');
    expect(generator).toContain('assets/fox-head-master.png');
    expect(generator).not.toContain("FOX_HEAD_MASTER_RELATIVE_PATH = 'assets/fox-head-master.svg'");
    expect(generator).not.toMatch(/function buildFoxHeadOps|function foxHeadSvg|function rasterizeFoxHead/);
  });

  it('ships a transparent 1254 fox with exact face and unique central-eye interiors', async () => {
    const {
      decodePng,
      FOX_HEAD_MASTER_SIZE,
      FOX_FACE_SAMPLE,
      FOX_FACE_RGBA,
      FOX_EYE_SAMPLE,
      FOX_EYE_RGBA,
      FOX_APPROVED_SEMANTIC_COUNTS,
      analyzeFoxHeadRaster,
    } = await loadGenerators();
    const master = decodePng(readFileSync(path.join(root, 'assets/fox-head-master.png')));
    const shared = decodePng(readFileSync(path.join(root, 'fox-head.png')));
    expect(shared.width).toBe(FOX_HEAD_MASTER_SIZE);
    expect(shared.height).toBe(FOX_HEAD_MASTER_SIZE);
    expect(master.width).toBe(FOX_HEAD_MASTER_SIZE);
    expect(master.height).toBe(FOX_HEAD_MASTER_SIZE);
    expect(sha256(readFileSync(path.join(root, 'assets/fox-head-master.png'))))
      .toBe(sha256(readFileSync(path.join(root, 'fox-head.png'))));
    expect(rgbaAt(shared.pixels, shared.width, FOX_FACE_SAMPLE.x, FOX_FACE_SAMPLE.y)).toEqual(FOX_FACE_RGBA);
    expect(rgbaAt(shared.pixels, shared.width, FOX_EYE_SAMPLE.x, FOX_EYE_SAMPLE.y)).toEqual(FOX_EYE_RGBA);

    const analysis = analyzeFoxHeadRaster(shared.pixels, shared.width, shared.height);
    expect(analysis.corners).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(analysis.checkerLike).toBe(0);
    expect(analysis.whiteGlints).toBe(0);
    expect(analysis.faceCore).toBe(FOX_APPROVED_SEMANTIC_COUNTS.faceCore);
    expect(analysis.eyeCore).toBe(FOX_APPROVED_SEMANTIC_COUNTS.eyeCore);
    expect(analysis.dualEyeHits).toBe(0);
    expect(analysis.eye.cx).toBeGreaterThan(520);
    expect(analysis.eye.cx).toBeLessThan(660);
    expect(analysis.stem.present).toBe(true);
    expect(analysis.leftTipY).toBeLessThan(analysis.rightTipY - 80);
    expect(analysis.bounds.minX).toBeGreaterThan(40);
    expect(analysis.bounds.minY).toBeGreaterThan(40);
    expect(analysis.bounds.maxX).toBeLessThan(1210);
    expect(analysis.bounds.maxY).toBeLessThan(1210);
  });

  it('keeps Dashboard dark headset geometrically identical except headset color', async () => {
    const {
      decodePng,
      FOX_FACE_SAMPLE,
      FOX_FACE_RGBA,
      FOX_EYE_SAMPLE,
      FOX_EYE_RGBA,
    } = await loadGenerators();
    const shared = decodePng(readFileSync(path.join(root, 'fox-head.png')));
    const dark = decodePng(readFileSync(path.join(root, 'src/renderer/assets/dashboard-fox-headset-dark.png')));
    expect(dark.width).toBe(shared.width);
    expect(dark.height).toBe(shared.height);

    expect(rgbaAt(dark.pixels, dark.width, FOX_FACE_SAMPLE.x, FOX_FACE_SAMPLE.y)).toEqual(FOX_FACE_RGBA);
    expect(rgbaAt(dark.pixels, dark.width, FOX_EYE_SAMPLE.x, FOX_EYE_SAMPLE.y)).toEqual(FOX_EYE_RGBA);

    let headset = 0;
    let identical = 0;
    let clearHeadset = 0;
    let alphaMismatch = 0;
    let leakedFaceOrEye = 0;
    let outsideHeadset = 0;
    for (let index = 0; index < shared.pixels.length; index += 4) {
      if (dark.pixels[index + 3] !== shared.pixels[index + 3]) alphaMismatch += 1;
      const sameRgb = shared.pixels[index] === dark.pixels[index]
        && shared.pixels[index + 1] === dark.pixels[index + 1]
        && shared.pixels[index + 2] === dark.pixels[index + 2];
      if (sameRgb) {
        identical += 1;
        continue;
      }
      headset += 1;
      const pixel = index / 4;
      const x = pixel % shared.width;
      const y = Math.floor(pixel / shared.width);
      if (!isInsideDashboardHeadsetZone(x, y)) outsideHeadset += 1;
      const sharedRgb = [shared.pixels[index], shared.pixels[index + 1], shared.pixels[index + 2]];
      const darkRgb = [dark.pixels[index], dark.pixels[index + 1], dark.pixels[index + 2]];
      if (
        (sharedRgb[0] === FOX_FACE_RGBA[0] && sharedRgb[1] === FOX_FACE_RGBA[1] && sharedRgb[2] === FOX_FACE_RGBA[2])
        || (sharedRgb[0] === FOX_EYE_RGBA[0] && sharedRgb[1] === FOX_EYE_RGBA[1] && sharedRgb[2] === FOX_EYE_RGBA[2])
        || (darkRgb[0] === FOX_FACE_RGBA[0] && darkRgb[1] === FOX_FACE_RGBA[1] && darkRgb[2] === FOX_FACE_RGBA[2])
        || (darkRgb[0] === FOX_EYE_RGBA[0] && darkRgb[1] === FOX_EYE_RGBA[1] && darkRgb[2] === FOX_EYE_RGBA[2])
      ) {
        leakedFaceOrEye += 1;
      }
      const sharedMax = Math.max(sharedRgb[0], sharedRgb[1], sharedRgb[2]);
      const darkMin = Math.min(darkRgb[0], darkRgb[1], darkRgb[2]);
      if (sharedMax < 130 && darkMin > 160) clearHeadset += 1;
    }
    expect(alphaMismatch).toBe(0);
    expect(leakedFaceOrEye).toBe(0);
    expect(outsideHeadset).toBe(0);
    expect(headset).toBeGreaterThan(800);
    expect(clearHeadset).toBeGreaterThan(800);
    expect(identical).toBeGreaterThan(headset);
    for (const [x, y] of [[181, 103], [589, 359], [520, 852], [576, 951], [573, 1102]]) {
      expect(rgbaAt(dark.pixels, dark.width, x, y))
        .toEqual(rgbaAt(shared.pixels, shared.width, x, y));
    }
  });

  it('rejects an invalid raster before replacing canonical or derived assets', async () => {
    const {
      decodePng,
      encodePngRgba,
      buildCanonicalMasterFromApproved,
      writeFoxHeadAssets,
      FOX_FACE_RGBA,
      FOX_EYE_RGBA,
      FOX_HEAD_MASTER_SIZE,
    } = await loadGenerators();
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'fox-head-invalid-'));
    try {
      const invalidPng = encodePngRgba(
        Buffer.alloc(FOX_HEAD_MASTER_SIZE * FOX_HEAD_MASTER_SIZE * 4),
        FOX_HEAD_MASTER_SIZE,
        FOX_HEAD_MASTER_SIZE,
      );
      const source = path.join(temporary, 'invalid-source.png');
      const canonical = path.join(temporary, 'canonical.png');
      const shared = path.join(temporary, 'shared.png');
      const dark = path.join(temporary, 'dark.png');
      writeFileSync(source, invalidPng);
      writeFileSync(canonical, Buffer.from('canonical-sentinel'));
      expect(() => buildCanonicalMasterFromApproved(source, canonical))
        .toThrow(/狐狸品牌资产合同失败/);
      expect(readFileSync(canonical).toString()).toBe('canonical-sentinel');

      writeFileSync(canonical, invalidPng);
      writeFileSync(shared, Buffer.from('shared-sentinel'));
      writeFileSync(dark, Buffer.from('dark-sentinel'));
      expect(() => writeFoxHeadAssets({ root, master: canonical, shared, dark, icons: false }))
        .toThrow(/狐狸品牌资产合同失败/);
      expect(readFileSync(shared).toString()).toBe('shared-sentinel');
      expect(readFileSync(dark).toString()).toBe('dark-sentinel');

      const approved = decodePng(readFileSync(path.join(root, 'assets/fox-head-master.png')));
      const driftCases = [
        {
          rgba: FOX_FACE_RGBA,
          retainedPixels: 1_000,
          error: /脸部纯色像素超出批准区间/,
        },
        {
          rgba: FOX_EYE_RGBA,
          retainedPixels: 100,
          error: /中央眼纯色像素超出批准区间/,
        },
      ];
      for (const driftCase of driftCases) {
        const recolored = Buffer.from(approved.pixels);
        let retainedPixels = 0;
        for (let index = 0; index < recolored.length; index += 4) {
          const matches = recolored[index] === driftCase.rgba[0]
            && recolored[index + 1] === driftCase.rgba[1]
            && recolored[index + 2] === driftCase.rgba[2]
            && recolored[index + 3] === driftCase.rgba[3];
          if (!matches) continue;
          retainedPixels += 1;
          if (retainedPixels <= driftCase.retainedPixels) continue;
          recolored[index] = 153;
          recolored[index + 1] = 112;
          recolored[index + 2] = 219;
        }
        writeFileSync(
          canonical,
          encodePngRgba(recolored, FOX_HEAD_MASTER_SIZE, FOX_HEAD_MASTER_SIZE),
        );
        expect(() => writeFoxHeadAssets({ root, master: canonical, shared, dark, icons: false }))
          .toThrow(driftCase.error);
        expect(readFileSync(shared).toString()).toBe('shared-sentinel');
        expect(readFileSync(dark).toString()).toBe('dark-sentinel');
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('generates identical PNG hashes across consecutive runs and keeps the Dock plate contract', async () => {
    const {
      deriveDarkHeadsetPixels,
      writeFoxHeadAssets,
      decodePng,
      generateAppIconMaster,
      APP_ICON_MASTER_SIZE,
      APP_ICON_FOX_FILL,
      APP_ICON_PLATE_SIZE,
    } = await loadGenerators();
    const masterPixels = decodePng(readFileSync(path.join(root, 'assets/fox-head-master.png'))).pixels;
    expect(sha256(deriveDarkHeadsetPixels(masterPixels, 1254, 1254)))
      .toBe(sha256(deriveDarkHeadsetPixels(masterPixels, 1254, 1254)));

    const tempA = mkdtempSync(path.join(os.tmpdir(), 'fox-head-a-'));
    const tempB = mkdtempSync(path.join(os.tmpdir(), 'fox-head-b-'));
    try {
      const writtenA = writeFoxHeadAssets({
        root,
        shared: path.join(tempA, 'fox-head.png'),
        dark: path.join(tempA, 'dashboard-fox-headset-dark.png'),
        icons: false,
      });
      const writtenB = writeFoxHeadAssets({
        root,
        shared: path.join(tempB, 'fox-head.png'),
        dark: path.join(tempB, 'dashboard-fox-headset-dark.png'),
        icons: false,
      });
      expect(sha256(readFileSync(writtenA.sharedPath))).toBe(sha256(readFileSync(writtenB.sharedPath)));
      expect(sha256(readFileSync(writtenA.darkPath))).toBe(sha256(readFileSync(writtenB.darkPath)));
      expect(sha256(readFileSync(writtenA.sharedPath)))
        .toBe(sha256(readFileSync(path.join(root, 'assets/fox-head-master.png'))));
    } finally {
      rmSync(tempA, { recursive: true, force: true });
      rmSync(tempB, { recursive: true, force: true });
    }

    const master = decodePng(readFileSync(path.join(root, 'assets/app-icon.png')));
    expect(master.width).toBe(APP_ICON_MASTER_SIZE);
    expect(master.height).toBe(APP_ICON_MASTER_SIZE);
    expect(rgbaAt(master.pixels, master.width, 0, 0)[3]).toBe(0);
    expect(rgbaAt(master.pixels, master.width, 1023, 0)[3]).toBe(0);
    expect(rgbaAt(master.pixels, master.width, 0, 1023)[3]).toBe(0);
    expect(rgbaAt(master.pixels, master.width, 1023, 1023)[3]).toBe(0);
    const plate = rgbaAt(master.pixels, master.width, 512, 96);
    expect(plate[3]).toBeGreaterThan(200);
    expect(plate[0]).toBeGreaterThan(235);
    expect(plate[1]).toBeGreaterThan(235);
    expect(plate[2]).toBeGreaterThan(235);

    const regenerated = path.join(os.tmpdir(), `fox-app-icon-${Date.now()}.png`);
    generateAppIconMaster({
      root,
      source: path.join(root, 'fox-head.png'),
      destination: regenerated,
    });
    expect(sha256(readFileSync(regenerated))).toBe(sha256(readFileSync(path.join(root, 'assets/app-icon.png'))));
    rmSync(regenerated, { force: true });
    expect(APP_ICON_FOX_FILL).toBeGreaterThan(0.7);
    expect(APP_ICON_PLATE_SIZE).toBe(896);
  });
});
