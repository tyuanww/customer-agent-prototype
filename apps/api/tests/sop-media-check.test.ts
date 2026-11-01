import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { INTAKE_POLICY as P } from '@customer-agent/content-intake';
import { checkSopMedia } from '../src/content-intake/sop-media-check.js';
import { sopImageFixtures as f } from './support/sop-image-fixtures.js';
import { sopImageRegressions as r } from './support/sop-image-regressions.js';

const image = (bytes: Buffer, mime: 'image/png' | 'image/jpeg' | 'image/gif', ordinal = 1, row = 2) =>
  ({ bytes, mime, sheet: '合成工作表', row, column: 3, ordinal });

describe('SOP media pixel checks', () => {
  it.each([
    ['PNG', f.validPng, 'image/png'],
    ['JPEG', f.validJpeg, 'image/jpeg'],
    ['grayscale JPEG', r.jpegGrayscale, 'image/jpeg'],
    ['progressive JPEG', f.progressiveJpeg, 'image/jpeg'],
    ['arithmetic JPEG', r.jpegArithmetic, 'image/jpeg'],
    ['lossless JPEG', r.jpegLossless, 'image/jpeg'],
    ['1-bit PNG', r.png1Bit, 'image/png'],
    ['16-bit grayscale PNG', r.pngGray16, 'image/png'],
    ['palette PNG', r.pngPalette, 'image/png'],
    ['RGBA PNG', r.pngRgba, 'image/png'],
  ] as const)('fully decodes %s', async (_name, bytes, mime) => {
    expect(await checkSopMedia([image(bytes, mime)])).toBeNull();
  });

  it.each([
    ['PNG pixel stream with valid CRC', f.corruptPng, 'image/png'],
    ['JPEG scan', f.corruptJpeg, 'image/jpeg'],
    ['JPEG scan missing a byte', r.jpegCorruptScan, 'image/jpeg'],
    ['PNG missing IEND', f.validPng.subarray(0, -12), 'image/png'],
    ['PNG invalid IEND CRC', Buffer.concat([f.validPng.subarray(0, -1), Buffer.from([f.validPng.at(-1)! ^ 1])]), 'image/png'],
  ] as const)('rejects damaged %s', async (_name, bytes, mime) => {
    expect(await checkSopMedia([image(bytes, mime)])).toEqual({
      code: 'MEDIA_DECODE_FAILED', sheet: '合成工作表', row: 2, column: 'C', fix: '图片无法完整解码，请重新导出或人工核对',
    });
  });

  it.each([
    ['CMYK JPEG', f.cmykJpeg],
    ['12-bit JPEG', r.jpeg12Bit],
    ['16-bit lossless JPEG', r.jpeg16Bit],
  ])('reports %s as unsupported rather than damaged', async (_name, bytes) => {
    expect(await checkSopMedia([image(bytes, 'image/jpeg')])).toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED' });
  });

  it('checks CRC on ancillary chunks as well as image data', async () => {
    const chunk = Buffer.alloc(12 + 3);
    chunk.writeUInt32BE(3, 0); chunk.write('tEXt', 4); chunk.write('a=b', 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 11)), 11);
    const png = Buffer.concat([f.validPng.subarray(0, -12), chunk, f.validPng.subarray(-12)]);
    expect(await checkSopMedia([image(png, 'image/png')])).toBeNull();
    const bad = Buffer.from(png); bad[bad.length - 13] = bad[bad.length - 13]! ^ 1;
    expect(await checkSopMedia([image(bad, 'image/png')])).toMatchObject({ code: 'MEDIA_DECODE_FAILED' });
  });

  it('accepts interlaced PNG without altering its bytes', async () => {
    const png = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#456789' } }).png({ progressive: true }).toBuffer();
    expect(png[28]).toBe(1);
    expect(await checkSopMedia([image(png, 'image/png')])).toBeNull();
  });

  it.each([f.validGif, r.gifStatic, r.gifBadSecondFrame])('reports GIF as unsupported with a conversion instruction', async gif => {
    expect(await checkSopMedia([image(gif, 'image/gif')])).toEqual({
      code: 'MEDIA_FORMAT_UNSUPPORTED', sheet: '合成工作表', row: 2, column: 'C',
      fix: 'SOP 暂不支持 GIF 图片，请转换为 PNG 或 JPEG 后重试',
    });
  });

  it.each([f.validApng, f.corruptApng])('reports APNG as unsupported rather than validating only its first frame', async bytes => {
    expect(await checkSopMedia([image(bytes, 'image/png')])).toMatchObject({ code: 'MEDIA_APNG_UNSUPPORTED' });
  });
  it('rejects declared MIME mismatches', async () => {
    expect(await checkSopMedia([image(f.validPng, 'image/gif')])).toMatchObject({ code: 'MEDIA_FORMAT_MISMATCH' });
    expect(await checkSopMedia([image(f.validGif, 'image/png')])).toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED', fix: expect.stringContaining('GIF') });
  });
  it('enforces compressed and decoded size bounds before decoding', async () => {
    expect(await checkSopMedia([image(Buffer.alloc(P.oneMediaBytes + 1), 'image/png')])).toMatchObject({ code: 'MEDIA_LIMIT' });
    const huge = Buffer.from(f.validPng);
    huge.writeUInt32BE(100_000, 16); huge.writeUInt32BE(100_000, 20);
    huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    expect(await checkSopMedia([image(huge, 'image/png')])).toMatchObject({ code: 'MEDIA_PIXEL_LIMIT' });
  });
  it('allows repeated placements of the same bytes without counting them as new objects', async () => {
    const images = Array.from({ length: 101 }, (_, index) => image(f.validPng, 'image/png', index < 100 ? index + 1 : 1, index < 100 ? 2 : 3));
    expect(await checkSopMedia(images)).toBeNull();
  });
});
