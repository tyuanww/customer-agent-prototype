import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { INTAKE_POLICY as P, IntakeFailure } from './policy.js';

export type WpsImageCoordinate = Readonly<{
  sheet: string;
  row: number;
  column: string;
  formula: string;
}>;

export type WpsImageIssue = Readonly<{
  code:
    | 'WPS_DISPIMG_INVALID'
    | 'WPS_IMAGE_MISSING'
    | 'WPS_IMAGE_RESPONSE_INVALID'
    | 'WPS_MEDIA_LIMIT'
    | 'WPS_IMAGE_FORMAT';
  sheet: string;
  row: number;
  column: string;
  fix: string;
}>;

export type WpsImage = Readonly<{
  id: string;
  sheet: string;
  row: number;
  column: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  extension: 'png' | 'jpeg' | 'gif';
  bytes: number;
  sha256: string;
  data: Buffer;
}>;

const DISPIMG = /\bDISPIMG\s*\(\s*["']([^"']+)["']\s*(?:,\s*\d+\s*)?\)/iu;

export function wpsDisplayImageId(formula: string): string | null {
  const match = DISPIMG.exec(formula);
  return match?.[1]?.trim() || null;
}

function localName(name: string): string {
  return name.split(':').at(-1) ?? name;
}

function relationshipPath(sourcePath: string): string {
  const directory = posix.dirname(sourcePath);
  return posix.join(directory, '_rels', `${posix.basename(sourcePath)}.rels`);
}

function safePackagePath(target: string): string | null {
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|[/\\])/iu.test(target)) return null;
  const normalized = posix.normalize(posix.join('xl', target));
  if (!normalized.startsWith('xl/') || normalized.split('/').includes('..')) return null;
  return normalized;
}

async function xmlFile(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return await entry.async('string');
  } catch {
    throw new IntakeFailure('INVALID_ZIP_XML');
  }
}

async function readRelationships(zip: JSZip, path: string): Promise<ReadonlyMap<string, string>> {
  const xml = await xmlFile(zip, path);
  if (xml === null) return new Map();
  const relationships = new Map<string, string>();
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => {
    throw new IntakeFailure('ACTIVE_CONTENT');
  });
  parser.on('opentag', (tag) => {
    if (localName(tag.name) !== 'Relationship') return;
    const id = String(tag.attributes.Id ?? '');
    const target = String(tag.attributes.Target ?? '');
    const mode = tag.attributes.TargetMode;
    if (!id || !target || (mode !== undefined && mode !== 'Internal')) {
      throw new IntakeFailure('EXTERNAL_RESOURCE');
    }
    const safe = safePackagePath(target);
    if (!safe) throw new IntakeFailure('EXTERNAL_RESOURCE');
    relationships.set(id, safe);
  });
  parser.write(xml).close();
  return relationships;
}

async function readDisplayImages(zip: JSZip): Promise<ReadonlyMap<string, string>> {
  const path = 'xl/cellimages.xml';
  const xml = await xmlFile(zip, path);
  if (xml === null) return new Map();
  const relationships = await readRelationships(zip, relationshipPath(path));
  const images = new Map<string, string>();
  const parser = new SaxesParser({ xmlns: false });
  let picture: { names: string[]; embed: string } | null = null;
  parser.on('doctype', () => {
    throw new IntakeFailure('ACTIVE_CONTENT');
  });
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (name === 'pic') {
      picture = { names: [], embed: '' };
      return;
    }
    if (!picture) return;
    if (name === 'cNvPr') {
      for (const key of ['id', 'name', 'descr']) {
        const value = tag.attributes[key];
        if (typeof value === 'string' && value.trim()) picture.names.push(value.trim());
      }
    }
    if (name === 'blip') {
      const embed = tag.attributes['r:embed'] ?? tag.attributes.embed;
      if (typeof embed === 'string') picture.embed = embed;
    }
  });
  parser.on('closetag', (tag) => {
    if (localName(tag.name) !== 'pic' || !picture) return;
    const target = relationships.get(picture.embed);
    if (target) {
      for (const name of picture.names) images.set(name, target);
    }
    picture = null;
  });
  parser.write(xml).close();
  return images;
}

function mediaType(bytes: Buffer): Readonly<{
  mime: WpsImage['mime'];
  extension: WpsImage['extension'];
}> | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpeg' };
  }
  const prefix = bytes.subarray(0, 6).toString('ascii');
  if (prefix === 'GIF87a' || prefix === 'GIF89a') {
    return { mime: 'image/gif', extension: 'gif' };
  }
  return null;
}

function issue(
  code: WpsImageIssue['code'],
  coordinate: WpsImageCoordinate,
  fix: string,
): WpsImageIssue {
  return {
    code,
    sheet: coordinate.sheet,
    row: coordinate.row,
    column: coordinate.column,
    fix,
  };
}

/** Resolve WPS `DISPIMG` references from `xl/cellimages.xml`. Only internal
 * relationships and PNG, JPEG, or GIF bytes are accepted. The adapter returns
 * no media when any coordinate fails, so callers cannot publish a partial mix. */
export async function extractWpsDisplayImages(
  zip: JSZip,
  coordinates: readonly WpsImageCoordinate[],
): Promise<Readonly<{ items: readonly WpsImage[]; issues: readonly WpsImageIssue[] }>> {
  let displayImages: ReadonlyMap<string, string>;
  try {
    displayImages = await readDisplayImages(zip);
  } catch {
    return {
      items: [],
      issues: coordinates.map((coordinate) =>
        issue('WPS_IMAGE_RESPONSE_INVALID', coordinate, 'WPS 图片索引损坏或指向外部资源，请重新导出')),
    };
  }
  const items: WpsImage[] = [];
  const issues: WpsImageIssue[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const coordinate of coordinates) {
    const displayId = wpsDisplayImageId(coordinate.formula);
    if (!displayId) {
      issues.push(issue('WPS_DISPIMG_INVALID', coordinate, '将资源单元格恢复为 WPS DISPIMG 图片公式'));
      continue;
    }
    const path = displayImages.get(displayId);
    const entry = path ? zip.file(path) : null;
    if (!entry) {
      issues.push(issue('WPS_IMAGE_MISSING', coordinate, '在 WPS 中重新插入图片并重新导出'));
      continue;
    }
    if (items.length >= P.mediaCount) {
      issues.push(issue('WPS_MEDIA_LIMIT', coordinate, '减少单个流程引用的图片数量'));
      continue;
    }
    const data = await entry.async('nodebuffer');
    totalBytes += data.length;
    if (data.length < 1 || data.length > P.oneMediaBytes || totalBytes > P.mediaBytes) {
      issues.push(issue('WPS_MEDIA_LIMIT', coordinate, '压缩图片或减少图片总大小'));
      continue;
    }
    const type = mediaType(data);
    if (!type) {
      issues.push(issue('WPS_IMAGE_FORMAT', coordinate, '仅使用 PNG、JPEG 或 GIF 图片'));
      continue;
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    const id = `med_${sha256}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      sheet: coordinate.sheet,
      row: coordinate.row,
      column: coordinate.column,
      mime: type.mime,
      extension: type.extension,
      bytes: data.length,
      sha256,
      data,
    });
  }
  return {
    items: issues.length === 0 ? items : [],
    issues,
  };
}
