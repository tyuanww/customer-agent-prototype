import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const ICO_FRAME_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
export const APP_ICON_MASTER_RELATIVE_PATH = 'assets/app-icon.png';
export const APP_ICON_MASTER_SIZE = 1024;
export const APP_ICON_PLATE_SIZE = 896;
export const APP_ICON_FOX_FILL = 0.75;
export const APP_ICON_PLATE_TOP = { r: 252, g: 252, b: 253 };
export const APP_ICON_PLATE_BOTTOM = { r: 245, g: 244, b: 248 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const masterOut = join(root, APP_ICON_MASTER_RELATIVE_PATH);
const pngOut = join(buildDir, 'icon.png');
const icoOut = join(buildDir, 'icon.ico');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, crcInput, crc]);
}

export function encodePngRgba(pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const destRow = y * (width * 4 + 1);
    raw[destRow] = 0;
    pixels.copy(raw, destRow + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    writeChunk('IHDR', ihdr),
    writeChunk('sRGB', Buffer.from([0])),
    writeChunk('IDAT', compressed),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  if (distanceUp <= distanceUpLeft) {
    return up;
  }
  return upLeft;
}

function unfilterScanlines(inflated, width, bytesPerPixel, height) {
  const stride = width * bytesPerPixel;
  const output = Buffer.alloc(stride * height);
  let source = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    const row = inflated.subarray(source, source + stride);
    source += stride;
    const dest = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? dest[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const raw = row[x];
      if (filter === 0) dest[x] = raw;
      else if (filter === 1) dest[x] = (raw + left) & 255;
      else if (filter === 2) dest[x] = (raw + up) & 255;
      else if (filter === 3) dest[x] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) dest[x] = (raw + paeth(left, up, upLeft)) & 255;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    dest.copy(output, y * stride);
    previous = dest;
  }
  return output;
}

export function decodePng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) {
    throw new Error('PNG missing IHDR');
  }
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  if (![1, 2, 3, 4].includes(bytesPerPixel)) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }
  const raw = unfilterScanlines(inflated, width, bytesPerPixel, height);
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * bytesPerPixel;
    const dest = index * 4;
    if (colorType === 6) {
      raw.copy(pixels, dest, source, source + 4);
    } else if (colorType === 2) {
      pixels[dest] = raw[source];
      pixels[dest + 1] = raw[source + 1];
      pixels[dest + 2] = raw[source + 2];
      pixels[dest + 3] = 255;
    } else if (colorType === 4) {
      pixels[dest] = raw[source];
      pixels[dest + 1] = raw[source];
      pixels[dest + 2] = raw[source];
      pixels[dest + 3] = raw[source + 1];
    } else {
      pixels[dest] = raw[source];
      pixels[dest + 1] = raw[source];
      pixels[dest + 2] = raw[source];
      pixels[dest + 3] = 255;
    }
  }
  return { width, height, pixels };
}

export function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function parseIcoFrames(buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO');
  }
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const listedWidth = buffer.readUInt8(entry);
    const listedHeight = buffer.readUInt8(entry + 1);
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    const png = buffer.subarray(offset, offset + bytes);
    const size = readPngSize(png);
    return {
      listedWidth: listedWidth === 0 ? 256 : listedWidth,
      listedHeight: listedHeight === 0 ? 256 : listedHeight,
      width: size.width,
      height: size.height,
    };
  });
}

export function writeIcoFromPngs(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = [];
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    const listed = frame.size >= 256 ? 0 : frame.size;
    entry.writeUInt8(listed, 0);
    entry.writeUInt8(listed, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += frame.png.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

export function alphaBounds(pixels, width, height, threshold = 12) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function sampleBilinear(source, width, height, x, y) {
  const clampedX = Math.min(width - 1, Math.max(0, x));
  const clampedY = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const pixel = (px, py) => {
    const index = (py * width + px) * 4;
    return [
      source[index],
      source[index + 1],
      source[index + 2],
      source[index + 3],
    ];
  };
  const mix = (left, right, t) => left.map((value, channel) => value * (1 - t) + right[channel] * t);
  const top = mix(pixel(x0, y0), pixel(x1, y0), tx);
  const bottom = mix(pixel(x0, y1), pixel(x1, y1), tx);
  return mix(top, bottom, ty);
}

function superellipseCoverage(localX, localY, radius, n = 5) {
  const nx = Math.abs(localX) / radius;
  const ny = Math.abs(localY) / radius;
  const value = nx ** n + ny ** n;
  const edge = 1.6 / radius;
  if (value <= 1 - edge) return 1;
  if (value >= 1 + edge) return 0;
  return Math.max(0, Math.min(1, (1 + edge - value) / (2 * edge)));
}

export function composeAppIconMaster(foxPixels, foxWidth, foxHeight) {
  const size = APP_ICON_MASTER_SIZE;
  const plate = APP_ICON_PLATE_SIZE;
  const canvas = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const plateRadius = plate / 2;
  const shadowOffsetY = 10;
  const shadowRadius = plateRadius + 6;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const localX = x - center;
      const localY = y - center;
      const shadow = superellipseCoverage(localX, localY - shadowOffsetY, shadowRadius) * 0.16;
      const plateCover = superellipseCoverage(localX, localY, plateRadius);
      const inner = superellipseCoverage(localX, localY, plateRadius - 1.15);
      const edge = Math.max(0, plateCover - inner);
      const t = Math.min(1, Math.max(0, (localY + plateRadius) / plate));
      const plateR = APP_ICON_PLATE_TOP.r + (APP_ICON_PLATE_BOTTOM.r - APP_ICON_PLATE_TOP.r) * t;
      const plateG = APP_ICON_PLATE_TOP.g + (APP_ICON_PLATE_BOTTOM.g - APP_ICON_PLATE_TOP.g) * t;
      const plateB = APP_ICON_PLATE_TOP.b + (APP_ICON_PLATE_BOTTOM.b - APP_ICON_PLATE_TOP.b) * t;
      const shadowR = 92;
      const shadowG = 86;
      const shadowB = 108;
      const edgeR = 156;
      const edgeG = 148;
      const edgeB = 168;
      let r = shadowR * shadow;
      let g = shadowG * shadow;
      let b = shadowB * shadow;
      let a = shadow * 255;
      if (plateCover > 0) {
        const alpha = plateCover;
        r = r * (1 - alpha) + plateR * alpha;
        g = g * (1 - alpha) + plateG * alpha;
        b = b * (1 - alpha) + plateB * alpha;
        a = Math.max(a, alpha * 255);
      }
      if (edge > 0) {
        r = r * (1 - edge * 0.55) + edgeR * edge * 0.55;
        g = g * (1 - edge * 0.55) + edgeG * edge * 0.55;
        b = b * (1 - edge * 0.55) + edgeB * edge * 0.55;
      }
      canvas[index] = Math.round(r);
      canvas[index + 1] = Math.round(g);
      canvas[index + 2] = Math.round(b);
      canvas[index + 3] = Math.round(a);
    }
  }

  const bounds = alphaBounds(foxPixels, foxWidth, foxHeight);
  const target = plate * APP_ICON_FOX_FILL;
  const scale = target / Math.max(bounds.width, bounds.height);
  const destWidth = bounds.width * scale;
  const destHeight = bounds.height * scale;
  const destLeft = center - destWidth / 2 + 0.5;
  const destTop = center - destHeight / 2 + 0.5;

  for (let y = Math.floor(destTop); y < Math.ceil(destTop + destHeight); y += 1) {
    if (y < 0 || y >= size) continue;
    for (let x = Math.floor(destLeft); x < Math.ceil(destLeft + destWidth); x += 1) {
      if (x < 0 || x >= size) continue;
      const srcX = bounds.minX + (x + 0.5 - destLeft) / scale - 0.5;
      const srcY = bounds.minY + (y + 0.5 - destTop) / scale - 0.5;
      const [sr, sg, sb, sa] = sampleBilinear(foxPixels, foxWidth, foxHeight, srcX, srcY);
      if (sa <= 1) continue;
      const index = (y * size + x) * 4;
      const alpha = sa / 255;
      canvas[index] = Math.round(canvas[index] * (1 - alpha) + sr * alpha);
      canvas[index + 1] = Math.round(canvas[index + 1] * (1 - alpha) + sg * alpha);
      canvas[index + 2] = Math.round(canvas[index + 2] * (1 - alpha) + sb * alpha);
      canvas[index + 3] = Math.max(canvas[index + 3], Math.round(sa));
    }
  }

  return canvas;
}

export function generateAppIconMaster(options = {}) {
  const projectRoot = options.root ?? root;
  const sourceIcon = options.source ?? join(projectRoot, 'fox-head.png');
  const destination = options.destination ?? join(projectRoot, APP_ICON_MASTER_RELATIVE_PATH);
  if (!existsSync(sourceIcon)) {
    throw new Error(`缺少仓内狐狸图标：${sourceIcon}`);
  }
  const decoded = decodePng(readFileSync(sourceIcon));
  const master = composeAppIconMaster(decoded.pixels, decoded.width, decoded.height);
  const png = encodePngRgba(master, APP_ICON_MASTER_SIZE, APP_ICON_MASTER_SIZE);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, png);
  return destination;
}

export function resizeRgbaDownsample(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceTop = targetY * scaleY;
    const sourceBottom = (targetY + 1) * scaleY;
    const firstSourceY = Math.floor(sourceTop);
    const lastSourceY = Math.ceil(sourceBottom);
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceLeft = targetX * scaleX;
      const sourceRight = (targetX + 1) * scaleX;
      const firstSourceX = Math.floor(sourceLeft);
      const lastSourceX = Math.ceil(sourceRight);
      let totalWeight = 0;
      let alphaWeight = 0;
      let premultipliedRed = 0;
      let premultipliedGreen = 0;
      let premultipliedBlue = 0;

      for (let sourceY = firstSourceY; sourceY < lastSourceY; sourceY += 1) {
        if (sourceY < 0 || sourceY >= sourceHeight) continue;
        const verticalWeight = Math.max(
          0,
          Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY),
        );
        for (let sourceX = firstSourceX; sourceX < lastSourceX; sourceX += 1) {
          if (sourceX < 0 || sourceX >= sourceWidth) continue;
          const horizontalWeight = Math.max(
            0,
            Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX),
          );
          const weight = horizontalWeight * verticalWeight;
          if (weight <= 0) continue;
          const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = source[sourceIndex + 3] / 255;
          totalWeight += weight;
          alphaWeight += alpha * weight;
          premultipliedRed += source[sourceIndex] * alpha * weight;
          premultipliedGreen += source[sourceIndex + 1] * alpha * weight;
          premultipliedBlue += source[sourceIndex + 2] * alpha * weight;
        }
      }

      const destinationIndex = (targetY * targetWidth + targetX) * 4;
      if (alphaWeight > 0) {
        output[destinationIndex] = Math.round(premultipliedRed / alphaWeight);
        output[destinationIndex + 1] = Math.round(premultipliedGreen / alphaWeight);
        output[destinationIndex + 2] = Math.round(premultipliedBlue / alphaWeight);
      }
      output[destinationIndex + 3] = totalWeight > 0
        ? Math.round((alphaWeight / totalWeight) * 255)
        : 0;
    }
  }

  return output;
}

export function generateWindowsIco(sourcePath, outputPath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`缺少应用图标源文件：${sourcePath}`);
  }
  const decoded = decodePng(readFileSync(sourcePath));
  const frames = ICO_FRAME_SIZES.map((size) => ({
    size,
    png: encodePngRgba(
      resizeRgbaDownsample(decoded.pixels, decoded.width, decoded.height, size, size),
      size,
      size,
    ),
  }));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, writeIcoFromPngs(frames));
}

export function generateAppIcons(options = {}) {
  const projectRoot = options.root ?? root;
  const foxSource = options.source ?? join(projectRoot, 'fox-head.png');
  const masterPath = options.master ?? join(projectRoot, APP_ICON_MASTER_RELATIVE_PATH);
  const outDir = options.outDir ?? join(projectRoot, 'build');
  generateAppIconMaster({ root: projectRoot, source: foxSource, destination: masterPath });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'icon.png'), readFileSync(masterPath));
  generateWindowsIco(masterPath, join(outDir, 'icon.ico'));
  if (process.platform === 'darwin' && options.icns !== false) {
    execFileSync('sh', [join(projectRoot, 'scripts/generate-mac-icon.sh')], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CUSTOMER_AGENT_ICON_MASTER: masterPath,
        CUSTOMER_AGENT_SKIP_MASTER_GENERATE: '1',
      },
    });
  }
  return masterPath;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (invokedDirectly && process.argv[2] === '--ico') {
  generateWindowsIco(process.argv[3], process.argv[4]);
} else if (invokedDirectly && process.argv[2] === '--master') {
  const destination = generateAppIconMaster({
    destination: process.argv[3] ? resolvePath(process.argv[3]) : undefined,
  });
  console.log(`已生成应用图标 master：${destination}`);
} else if (invokedDirectly) {
  generateAppIcons();
  console.log(
    process.platform === 'darwin'
      ? `已生成应用图标 master / ICO / PNG / ICNS：${masterOut}、${pngOut}、${icoOut}`
      : `已生成应用图标 master / ICO / PNG：${masterOut}、${pngOut}、${icoOut}`,
  );
}
