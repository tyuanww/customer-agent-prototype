import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePng,
  encodePngRgba,
  generateAppIcons,
  resizeRgbaDownsample,
} from './generate-app-icons.mjs';

export const FOX_HEAD_MASTER_SIZE = 1254;
export const FOX_HEAD_MASTER_RELATIVE_PATH = 'assets/fox-head-master.png';
export const FOX_HEAD_SHARED_RELATIVE_PATH = 'fox-head.png';
export const FOX_HEAD_DARK_RELATIVE_PATH = 'src/renderer/assets/dashboard-fox-headset-dark.png';

export const FOX_FACE_RGBA = [249, 214, 197, 255];
export const FOX_EYE_RGBA = [164, 92, 74, 255];
export const FOX_FACE_HEX = '#F9D6C5';
export const FOX_EYE_HEX = '#A45C4A';
export const FOX_HEADSET_LIGHT_RGBA = [246, 244, 250, 255];
export const FOX_HEADSET_LIGHT_INNER_RGBA = [214, 210, 222, 255];

const FACE_CLUSTER = [253, 214, 195];
const EYE_CLUSTER = [164, 81, 53];
const HEADSET_FILL = [56, 36, 85];
const HEADSET_COMPONENT_MIN_PIXELS = 512;
const HEADSET_COMPONENT_ZONES = [
  { minX: 360, maxX: 980, minY: 130, maxY: 340 },
  { minX: 60, maxX: 260, minY: 560, maxY: 880 },
  { minX: 930, maxX: 1170, minY: 560, maxY: 880 },
  { minX: 690, maxX: 1110, minY: 740, maxY: 1040 },
];

export const FOX_FACE_SAMPLE = { x: 569, y: 970 };
export const FOX_EYE_SAMPLE = { x: 581, y: 904 };
export const FOX_EYE_WINDOW = { minX: 450, maxX: 760, minY: 820, maxY: 1020 };

// Semantic counts from the user-approved canonical raster. Keep a small
// allowance for deterministic renderer/encoder changes while rejecting broad
// recolors that would otherwise preserve the silhouette and sample pixels.
export const FOX_APPROVED_SEMANTIC_COUNTS = Object.freeze({
  faceCore: 99_821,
  eyeCore: 7_566,
});
const FOX_SEMANTIC_COUNT_TOLERANCE = Object.freeze({
  faceCore: 0.05,
  eyeCore: 0.08,
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function colorDist(red, green, blue, target) {
  const dr = red - target[0];
  const dg = green - target[1];
  const db = blue - target[2];
  return Math.hypot(dr, dg, db);
}

function luminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function isFaceLike(red, green, blue, alpha) {
  if (alpha < 250) return false;
  if (red < 220 || green < 175 || blue < 155) return false;
  if (!(red > green && green >= blue - 8)) return false;
  if (red - blue < 20 || blue > 225) return false;
  return colorDist(red, green, blue, FACE_CLUSTER) <= 18
    || colorDist(red, green, blue, FOX_FACE_RGBA) <= 18;
}

export function isEyeLike(red, green, blue, alpha) {
  if (alpha < 250) return false;
  if (red < 120 || red > 200 || green > 145 || blue > 115) return false;
  if (red < green + 20 || red < blue + 25) return false;
  return colorDist(red, green, blue, EYE_CLUSTER) <= 22
    || colorDist(red, green, blue, FOX_EYE_RGBA) <= 22;
}

export function isHeadsetFill(red, green, blue, alpha) {
  if (alpha < 248) return false;
  const lum = luminance(red, green, blue);
  if (lum < 32 || lum > 70) return false;
  if (blue < green + 18 || red > 110) return false;
  return colorDist(red, green, blue, HEADSET_FILL) <= 36;
}

export function isInteriorPixel(pixels, width, height, x, y, minNeighborAlpha = 180) {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return false;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (pixels[(((y + dy) * width + (x + dx)) * 4) + 3] < minNeighborAlpha) {
        return false;
      }
    }
  }
  return true;
}

export function fitApprovedRasterToMaster(source, sourceWidth, sourceHeight) {
  const size = FOX_HEAD_MASTER_SIZE;
  const scale = size / Math.max(sourceWidth, sourceHeight);
  const destWidth = Math.round(sourceWidth * scale);
  const destHeight = Math.round(sourceHeight * scale);
  const fitted = destWidth === sourceWidth && destHeight === sourceHeight
    ? source
    : resizeRgbaDownsample(source, sourceWidth, sourceHeight, destWidth, destHeight);
  const canvas = Buffer.alloc(size * size * 4);
  const offsetX = Math.floor((size - destWidth) / 2);
  const offsetY = Math.floor((size - destHeight) / 2);
  for (let y = 0; y < destHeight; y += 1) {
    const sourceStart = y * destWidth * 4;
    const destStart = ((y + offsetY) * size + offsetX) * 4;
    fitted.copy(canvas, destStart, sourceStart, sourceStart + destWidth * 4);
  }
  return canvas;
}

export function recolorBrandInteriors(pixels, width, height) {
  const output = Buffer.from(pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInteriorPixel(pixels, width, height, x, y, 180)) continue;
      const index = (y * width + x) * 4;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (isFaceLike(red, green, blue, alpha)) {
        output[index] = FOX_FACE_RGBA[0];
        output[index + 1] = FOX_FACE_RGBA[1];
        output[index + 2] = FOX_FACE_RGBA[2];
        output[index + 3] = 255;
        continue;
      }
      if (
        isEyeLike(red, green, blue, alpha)
        && x >= FOX_EYE_WINDOW.minX
        && x <= FOX_EYE_WINDOW.maxX
        && y >= FOX_EYE_WINDOW.minY
        && y <= FOX_EYE_WINDOW.maxY
      ) {
        output[index] = FOX_EYE_RGBA[0];
        output[index + 1] = FOX_EYE_RGBA[1];
        output[index + 2] = FOX_EYE_RGBA[2];
        output[index + 3] = 255;
      }
    }
  }
  return output;
}

function isHatLike(red, green, blue, alpha) {
  return alpha >= 240 && red > 100 && green > 70 && blue > 170 && luminance(red, green, blue) > 90;
}

function isExactBrandBody(red, green, blue, alpha) {
  return alpha === 255 && (
    (red === FOX_FACE_RGBA[0] && green === FOX_FACE_RGBA[1] && blue === FOX_FACE_RGBA[2])
    || (red === FOX_EYE_RGBA[0] && green === FOX_EYE_RGBA[1] && blue === FOX_EYE_RGBA[2])
  );
}

export function deriveDarkHeadsetPixels(pixels, width, height) {
  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInteriorPixel(pixels, width, height, x, y, 160)) continue;
      const index = (y * width + x) * 4;
      if (isHeadsetFill(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) {
        mask[y * width + x] = 1;
      }
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const grown = Buffer.from(mask);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const cell = y * width + x;
        if (mask[cell]) continue;
        const index = cell * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha < 248) continue;
        if (isExactBrandBody(red, green, blue, alpha) || isHatLike(red, green, blue, alpha)) continue;
        const lum = luminance(red, green, blue);
        if (lum < 14 || lum > 80 || blue < green + 8 || red > 120) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            if (mask[(y + dy) * width + (x + dx)]) neighbors += 1;
          }
        }
        if (neighbors >= 4) grown[cell] = 1;
      }
    }
    grown.copy(mask);
  }

  // The approved raster uses related dark-plum tones for both its outline and
  // headset. Keep only sizeable connected components that live inside the
  // known headset regions; isolated hat/brim/face/stem pixels must remain
  // byte-identical to the shared asset.
  const retained = Buffer.alloc(width * height);
  const visited = Buffer.alloc(width * height);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    const component = [];
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (stack.length > 0) {
      const cell = stack.pop();
      component.push(cell);
      const x = cell % width;
      const y = Math.floor(cell / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [];
      if (x > 0) neighbors.push(cell - 1);
      if (x < width - 1) neighbors.push(cell + 1);
      if (y > 0) neighbors.push(cell - width);
      if (y < height - 1) neighbors.push(cell + width);
      for (const neighbor of neighbors) {
        if (!mask[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    const insideHeadsetZone = HEADSET_COMPONENT_ZONES.some((zone) => (
      minX >= zone.minX
      && maxX <= zone.maxX
      && minY >= zone.minY
      && maxY <= zone.maxY
    ));
    if (component.length < HEADSET_COMPONENT_MIN_PIXELS || !insideHeadsetZone) continue;
    for (const cell of component) retained[cell] = 1;
  }
  retained.copy(mask);

  const output = Buffer.from(pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      const index = (y * width + x) * 4;
      const target = luminance(pixels[index], pixels[index + 1], pixels[index + 2]) < 36
        ? FOX_HEADSET_LIGHT_INNER_RGBA
        : FOX_HEADSET_LIGHT_RGBA;
      output[index] = target[0];
      output[index + 1] = target[1];
      output[index + 2] = target[2];
    }
  }
  return output;
}

export function analyzeFoxHeadRaster(pixels, width, height) {
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ].map(([x, y]) => {
    const index = (y * width + x) * 4;
    return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
  });

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let faceCore = 0;
  let eyeCore = 0;
  let dualEyeHits = 0;
  let checkerLike = 0;
  let whiteGlints = 0;
  let leftTipY = height;
  let rightTipY = height;
  let eyeSumX = 0;
  let eyeSumY = 0;
  let eyeMinX = width;
  let eyeMaxX = -1;
  let eyeMinY = height;
  let eyeMaxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 40) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (x < 520 && y < leftTipY) leftTipY = y;
        if (x > 900 && y < rightTipY) rightTipY = y;
      }
      if (alpha > 200 && red > 240 && green > 240 && blue > 240) {
        whiteGlints += 1;
      }
      if (
        alpha > 200
        && red > 180
        && green > 180
        && blue > 180
        && Math.max(red, green, blue) - Math.min(red, green, blue) < 18
      ) {
        checkerLike += 1;
      }
      if (
        alpha === 255
        && red === FOX_FACE_RGBA[0]
        && green === FOX_FACE_RGBA[1]
        && blue === FOX_FACE_RGBA[2]
      ) {
        faceCore += 1;
      }
      if (
        alpha === 255
        && red === FOX_EYE_RGBA[0]
        && green === FOX_EYE_RGBA[1]
        && blue === FOX_EYE_RGBA[2]
      ) {
        eyeCore += 1;
        eyeSumX += x;
        eyeSumY += y;
        if (x < eyeMinX) eyeMinX = x;
        if (x > eyeMaxX) eyeMaxX = x;
        if (y < eyeMinY) eyeMinY = y;
        if (y > eyeMaxY) eyeMaxY = y;
        if (
          x < FOX_EYE_WINDOW.minX
          || x > FOX_EYE_WINDOW.maxX
          || y < FOX_EYE_WINDOW.minY
          || y > FOX_EYE_WINDOW.maxY
        ) {
          dualEyeHits += 1;
        }
      }
    }
  }

  const eyeCx = eyeCore > 0 ? eyeSumX / eyeCore : 0;
  const eyeCy = eyeCore > 0 ? eyeSumY / eyeCore : 0;
  let stemRows = 0;
  let stemMinY = height;
  let stemMaxY = -1;
  if (eyeCore > 0) {
    const scanTop = Math.min(height - 1, eyeMaxY + 2);
    const scanBottom = Math.min(height - 1, eyeMaxY + 90);
    const scanLeft = Math.max(0, Math.round(eyeCx) - 22);
    const scanRight = Math.min(width - 1, Math.round(eyeCx) + 22);
    for (let y = scanTop; y <= scanBottom; y += 1) {
      let darkLeft = width;
      let darkRight = -1;
      for (let x = scanLeft; x <= scanRight; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = pixels[index + 3];
        if (alpha < 200) continue;
        if (luminance(pixels[index], pixels[index + 1], pixels[index + 2]) >= 40) continue;
        if (x < darkLeft) darkLeft = x;
        if (x > darkRight) darkRight = x;
      }
      const span = darkRight >= darkLeft ? darkRight - darkLeft + 1 : 0;
      if (span >= 3 && span <= 22) {
        stemRows += 1;
        if (y < stemMinY) stemMinY = y;
        if (y > stemMaxY) stemMaxY = y;
      }
    }
  }

  return {
    width,
    height,
    corners,
    bounds: { minX, minY, maxX, maxY },
    leftTipY,
    rightTipY,
    faceCore,
    eyeCore,
    dualEyeHits,
    checkerLike,
    whiteGlints,
    eye: {
      cx: eyeCx,
      cy: eyeCy,
      minX: eyeMinX,
      maxX: eyeMaxX,
      minY: eyeMinY,
      maxY: eyeMaxY,
    },
    stem: {
      rows: stemRows,
      minY: stemMinY,
      maxY: stemMaxY,
      present: stemRows >= 8,
    },
  };
}

function approvedSemanticRange(key) {
  const approved = FOX_APPROVED_SEMANTIC_COUNTS[key];
  const tolerance = FOX_SEMANTIC_COUNT_TOLERANCE[key];
  return {
    min: Math.floor(approved * (1 - tolerance)),
    max: Math.ceil(approved * (1 + tolerance)),
  };
}

export function assertFoxHeadRasterContract(pixels, width, height) {
  const analysis = analyzeFoxHeadRaster(pixels, width, height);
  const transparentCorners = analysis.corners.every((corner) => corner[3] === 0);
  const faceCoreRange = approvedSemanticRange('faceCore');
  const eyeCoreRange = approvedSemanticRange('eyeCore');
  const errors = [];
  if (width !== FOX_HEAD_MASTER_SIZE || height !== FOX_HEAD_MASTER_SIZE) {
    errors.push(`尺寸必须为 ${FOX_HEAD_MASTER_SIZE}×${FOX_HEAD_MASTER_SIZE}`);
  }
  if (!transparentCorners) errors.push('四角必须是真透明');
  if (analysis.checkerLike !== 0) errors.push('不得包含烘焙棋盘背景');
  if (analysis.whiteGlints !== 0) errors.push('不得包含白色双眼或高光点');
  if (analysis.faceCore < faceCoreRange.min || analysis.faceCore > faceCoreRange.max) {
    errors.push(
      `#F9D6C5 脸部纯色像素超出批准区间 `
      + `${faceCoreRange.min}–${faceCoreRange.max}：${analysis.faceCore}`,
    );
  }
  if (analysis.eyeCore < eyeCoreRange.min || analysis.eyeCore > eyeCoreRange.max) {
    errors.push(
      `#A45C4A 中央眼纯色像素超出批准区间 `
      + `${eyeCoreRange.min}–${eyeCoreRange.max}：${analysis.eyeCore}`,
    );
  }
  if (analysis.dualEyeHits !== 0) errors.push('检测到中央眼窗外的同色眼部像素');
  if (analysis.eye.cx <= 520 || analysis.eye.cx >= 660) errors.push('中央眼光学位置漂移');
  if (!analysis.stem.present) errors.push('中央眼下短竖线缺失');
  if (analysis.leftTipY >= analysis.rightTipY - 80) errors.push('左右耳非对称轮廓丢失');
  if (
    analysis.bounds.minX <= 40
    || analysis.bounds.minY <= 40
    || analysis.bounds.maxX >= 1210
    || analysis.bounds.maxY >= 1210
  ) {
    errors.push('主体超出安全留白');
  }
  if (errors.length > 0) {
    throw new Error(`狐狸品牌资产合同失败：${errors.join('；')}`);
  }
  return analysis;
}

export function buildCanonicalMasterFromApproved(sourcePath, destinationPath) {
  const decoded = decodePng(readFileSync(sourcePath));
  const fitted = fitApprovedRasterToMaster(decoded.pixels, decoded.width, decoded.height);
  const recolored = recolorBrandInteriors(fitted, FOX_HEAD_MASTER_SIZE, FOX_HEAD_MASTER_SIZE);
  assertFoxHeadRasterContract(recolored, FOX_HEAD_MASTER_SIZE, FOX_HEAD_MASTER_SIZE);
  const png = encodePngRgba(recolored, FOX_HEAD_MASTER_SIZE, FOX_HEAD_MASTER_SIZE);
  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, png);
  return destinationPath;
}

export function writeFoxHeadAssets(options = {}) {
  const projectRoot = options.root ?? root;
  const masterPath = options.master ?? join(projectRoot, FOX_HEAD_MASTER_RELATIVE_PATH);
  const sharedPath = options.shared ?? join(projectRoot, FOX_HEAD_SHARED_RELATIVE_PATH);
  const darkPath = options.dark ?? join(projectRoot, FOX_HEAD_DARK_RELATIVE_PATH);
  if (!existsSync(masterPath)) {
    throw new Error(`缺少 raster canonical master：${masterPath}`);
  }
  const masterBytes = readFileSync(masterPath);
  const decoded = decodePng(masterBytes);
  if (decoded.width !== FOX_HEAD_MASTER_SIZE || decoded.height !== FOX_HEAD_MASTER_SIZE) {
    throw new Error(`master 必须是 ${FOX_HEAD_MASTER_SIZE} 正方形 RGBA`);
  }
  assertFoxHeadRasterContract(decoded.pixels, decoded.width, decoded.height);
  mkdirSync(dirname(sharedPath), { recursive: true });
  mkdirSync(dirname(darkPath), { recursive: true });
  writeFileSync(sharedPath, masterBytes);
  const darkPixels = deriveDarkHeadsetPixels(decoded.pixels, decoded.width, decoded.height);
  writeFileSync(darkPath, encodePngRgba(darkPixels, decoded.width, decoded.height));
  if (options.icons !== false) {
    generateAppIcons({ root: projectRoot, source: sharedPath });
  }
  return { masterPath, sharedPath, darkPath };
}

export function writeApprovedFoxQa(options = {}) {
  const projectRoot = options.root ?? root;
  const directory = options.dir ?? join(projectRoot, 'evidence/qa/2026-08-17-approved-fox');
  mkdirSync(directory, { recursive: true });
  const shared = decodePng(readFileSync(join(projectRoot, FOX_HEAD_SHARED_RELATIVE_PATH)));
  const dark = decodePng(readFileSync(join(projectRoot, FOX_HEAD_DARK_RELATIVE_PATH)));
  const dock = decodePng(readFileSync(join(projectRoot, 'assets/app-icon.png')));
  const writeSized = (name, source, sourceWidth, sourceHeight, size) => {
    writeFileSync(
      join(directory, name),
      encodePngRgba(
        resizeRgbaDownsample(source, sourceWidth, sourceHeight, size, size),
        size,
        size,
      ),
    );
  };
  writeSized('float-64.png', shared.pixels, shared.width, shared.height, 64);
  writeSized('dashboard-light-40.png', shared.pixels, shared.width, shared.height, 40);
  writeSized('dashboard-dark-40.png', dark.pixels, dark.width, dark.height, 40);
  writeSized('tray-20.png', shared.pixels, shared.width, shared.height, 20);
  writeSized('dock-20.png', dock.pixels, dock.width, dock.height, 20);
  return directory;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  const fromApprovedIndex = process.argv.indexOf('--from-approved');
  if (fromApprovedIndex !== -1) {
    const sourcePath = process.argv[fromApprovedIndex + 1];
    if (!sourcePath || sourcePath.startsWith('--')) {
      throw new Error('`--from-approved` 需要批准 RGBA 源文件路径');
    }
    const masterPath = join(root, FOX_HEAD_MASTER_RELATIVE_PATH);
    buildCanonicalMasterFromApproved(sourcePath, masterPath);
    console.log(`已从批准 RGBA 生产化 raster canonical：${masterPath}`);
  }
  const written = writeFoxHeadAssets({ icons: !process.argv.includes('--skip-icons') });
  if (process.argv.includes('--qa')) {
    writeApprovedFoxQa({ root });
  }
  console.log(`已从 raster canonical 派生共享 PNG / Dashboard 深色耳麦：${written.sharedPath}`);
}
