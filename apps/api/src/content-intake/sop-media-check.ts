import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import initializeJpeg from '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs';
import { INTAKE_POLICY as P, type Issue } from '@customer-agent/content-intake';

type Image = Readonly<{ bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/gif'; sheet: string; row: number; column: number; ordinal: number }>;
type Dimensions = Readonly<{ width: number; height: number }>;
type Inspection<T> = { kind: 'ok'; value: T } | { kind: 'invalid' } | { kind: 'unsupported' } | { kind: 'limit' };

const MAX_RASTER_PIXELS = Math.floor(P.outputBytes / 4);
const require = createRequire(import.meta.url);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function columnName(column: number): string {
  let value = column, name = '';
  while (value > 0) {
    value--;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function withinPixels(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= Math.floor(MAX_RASTER_PIXELS / height);
}

function format(bytes: Buffer): Image['mime'] | null {
  if (bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString('latin1') === 'GIF87a' || bytes.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  return null;
}

function inspectPng(bytes: Buffer): Inspection<Dimensions & { animated: boolean }> {
  let offset = 8, width = 0, height = 0, hasHeader = false, hasData = false, animated = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return { kind: 'invalid' };
    const typeOffset = offset + 4, dataOffset = offset + 8, end = dataOffset + length;
    const type = bytes.toString('latin1', typeOffset, dataOffset);
    if (!/^[A-Za-z]{4}$/u.test(type) || crc32(bytes.subarray(typeOffset, end)) !== bytes.readUInt32BE(end)) return { kind: 'invalid' };
    if (!hasHeader && type !== 'IHDR') return { kind: 'invalid' };
    if (type === 'IHDR') {
      if (hasHeader || length !== 13) return { kind: 'invalid' };
      width = bytes.readUInt32BE(dataOffset); height = bytes.readUInt32BE(dataOffset + 4); hasHeader = true;
      if (!width || !height) return { kind: 'invalid' };
      if (!withinPixels(width, height)) return { kind: 'limit' };
    } else if (type === 'IDAT') {
      hasData = true;
    } else if (type === 'acTL') {
      animated = true;
    } else if (type === 'IEND') {
      if (length !== 0 || !hasData || end + 4 !== bytes.length) return { kind: 'invalid' };
      return { kind: 'ok', value: { width, height, animated } };
    } else if (type[0] === type[0]?.toUpperCase() && type !== 'PLTE') {
      return { kind: 'unsupported' };
    }
    offset = end + 4;
  }
  return { kind: 'invalid' };
}

function inspectJpeg(bytes: Buffer): Inspection<Dimensions> {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { kind: 'invalid' };
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return { kind: 'invalid' };
    const marker = bytes[offset++]!;
    if (marker === 0x00 || marker === 0xda || marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return { kind: 'invalid' };
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return { kind: 'invalid' };
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) return { kind: 'invalid' };
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) return { kind: 'invalid' };
      const precision = bytes[offset + 2]!, height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5), components = bytes[offset + 7]!;
      if (!precision || !components || length !== 8 + components * 3 || !width) return { kind: 'invalid' };
      if (!height || precision !== 8 || ![1, 3].includes(components) || ![0xc0, 0xc1, 0xc2, 0xc3, 0xc9, 0xca].includes(marker)) return { kind: 'unsupported' };
      if (!withinPixels(width, height)) return { kind: 'limit' };
      return { kind: 'ok', value: { width, height } };
    }
    offset += length;
  }
  return { kind: 'invalid' };
}

async function createJpegCodec() {
  let warnings = 0;
  const warn = () => { warnings++; };
  const wasmBinary = readFileSync(require.resolve('@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasm'));
  const module = await initializeJpeg({ wasmBinary, print: warn, printErr: warn });
  return { module, reset: () => { warnings = 0; }, hasWarnings: () => warnings > 0 };
}

/** Runs only in the parser child; no validated image is changed or persisted here. */
export async function checkSopMedia(images: readonly Image[]): Promise<Issue | null> {
  if (images.length > P.cells) return { code: 'MEDIA_LIMIT', sheet: '', row: 0, column: '', fix: '图片引用数量超出限制' };
  const checked = new Set<string>();
  let uniqueBytes = 0, jpegCodec: ReturnType<typeof createJpegCodec> | undefined;
  for (const image of images) {
    const issue = (code: string, fix: string): Issue => ({ code, sheet: image.sheet, row: image.row, column: columnName(image.column), fix });
    const actual = format(image.bytes);
    if (actual === 'image/gif' || (image.mime === 'image/gif' && !actual)) {
      return issue('MEDIA_FORMAT_UNSUPPORTED', 'SOP 暂不支持 GIF 图片，请转换为 PNG 或 JPEG 后重试');
    }
    if (actual && actual !== image.mime) return issue('MEDIA_FORMAT_MISMATCH', '图片实际格式与文件声明不一致');
    if (image.ordinal < 1 || image.ordinal > P.mediaCount) return issue('MEDIA_LIMIT', '同一行的图片数量超出限制');
    if (image.bytes.length === 0 || image.bytes.length > P.oneMediaBytes) return issue('MEDIA_LIMIT', '单张图片大小超出限制');
    const identity = `${image.mime}:${createHash('sha256').update(image.bytes).digest('hex')}`;
    if (checked.has(identity)) continue;
    checked.add(identity); uniqueBytes += image.bytes.length;
    if (checked.size > P.mediaCount || uniqueBytes > P.mediaBytes) return issue('MEDIA_LIMIT', '图片数量或总大小超出限制');
    if (!actual) return issue('MEDIA_DECODE_FAILED', '图片无法完整解码，请重新导出或人工核对');
    const inspection = actual === 'image/png' ? inspectPng(image.bytes) : inspectJpeg(image.bytes);
    if (inspection.kind === 'invalid') return issue('MEDIA_DECODE_FAILED', '图片无法完整解码，请重新导出或人工核对');
    if (inspection.kind === 'limit') return issue('MEDIA_PIXEL_LIMIT', '图片尺寸超出解码限制，请压缩或拆分');
    if (inspection.kind === 'unsupported') {
      return issue('MEDIA_FORMAT_UNSUPPORTED', actual === 'image/jpeg'
        ? '该 JPEG 的位深或颜色模式暂无法完整校验，请转为 8 位 RGB 或灰度 JPEG'
        : '该图片的格式特性暂无法完整校验，请转换后重试或人工核对');
    }
    const dimensions = inspection.value;
    if (actual === 'image/png' && 'animated' in dimensions && dimensions.animated) {
      return issue('MEDIA_APNG_UNSUPPORTED', '暂不能完整校验 APNG 动图，请转换为静态 PNG 或等待支持');
    }
    const codec = actual === 'image/jpeg' ? await (jpegCodec ??= createJpegCodec()) : undefined;
    try {
      if (actual === 'image/jpeg') {
        if (!codec) throw new Error('JPEG_CODEC_MISSING');
        codec.reset();
        const decoder = new codec.module.JPEGDecoder();
        try {
          decoder.getEncodedBuffer(image.bytes.length).set(image.bytes);
          decoder.readHeader();
          const info = decoder.getFrameInfo();
          if (info.width !== dimensions.width || info.height !== dimensions.height || info.bitsPerSample !== 8 || ![1, 3].includes(info.componentCount)) {
            return issue('MEDIA_FORMAT_UNSUPPORTED', '该 JPEG 暂无法完整校验，请转为 8 位 RGB 或灰度 JPEG');
          }
          decoder.decode();
          if (decoder.getDecodedBuffer().length !== info.width * info.height * info.componentCount) throw new Error('JPEG_PIXEL_SIZE');
          if (codec.hasWarnings()) return issue('MEDIA_NEEDS_REVIEW', '该 JPEG 存在解码提示，请重新导出或人工核对');
        } finally { decoder.delete(); }
      } else {
        const { data, info } = await sharp(image.bytes, { failOn: 'warning', limitInputPixels: MAX_RASTER_PIXELS }).raw().toBuffer({ resolveWithObject: true });
        if (info.width !== dimensions.width || info.height !== dimensions.height || data.length !== info.width * info.height * info.channels) throw new Error('PNG_PIXEL_SIZE');
      }
    } catch {
      return issue('MEDIA_DECODE_FAILED', '图片无法完整解码，请重新导出或人工核对');
    }
  }
  return null;
}
