import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { inspectArchive } from './archive.js';
import { imageMime } from './maintenance.js';
import { isSopGif, SOP_GIF_UNSUPPORTED_FIX } from './sop.js';
import { INTAKE_POLICY as P } from './policy.js';

/** The marker is an accident-prevention gate, not proof that content is synthetic. */
export const SYNTHETIC_SOURCE_CREATOR = 'SOP-SYNTHETIC-ONLY';
export const SOURCE_INVENTORY_VERSION = 'sop-synthetic-source-v1';

type AnchorPosition = Readonly<{
  kind: 'twoCellAnchor' | 'oneCellAnchor' | 'absoluteAnchor';
  from: Readonly<Record<string, number>>;
  to: Readonly<Record<string, number>>;
  extent: Readonly<Record<string, number>>;
}>;
export type SourceText = Readonly<{
  kind: 'text'; id: string; sheet: string; cell: string; text: string; codePoints: number;
}>;
export type SourceImage = Readonly<{
  kind: 'image' | 'background'; id: string; sheet: string; location: string;
  position: AnchorPosition | null; sha256: string; extension: 'png' | 'jpeg' | 'gif';
  width: number; height: number; reviewWarnings: readonly string[];
}>;
export type SourceUnsupported = Readonly<{
  kind: 'unsupported'; id: string; sheet: string; location: string; reason: string; rawText?: string;
}>;
export type SourceObject = SourceText | SourceImage | SourceUnsupported;
export type SourceInventory = Readonly<{
  version: typeof SOURCE_INVENTORY_VERSION; sourceSha256: string; publishable: false;
  sheets: readonly Readonly<{ name: string; merges: readonly string[] }>[];
  objects: readonly SourceObject[];
}>;
export type InspectedSource = Readonly<{ inventory: SourceInventory; images: ReadonlyMap<string, Buffer> }>;

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const D = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAX_OBJECTS = 20_000;
const digest = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const attr = (tag: SaxesTagNS, uri: string, local: string): string | undefined =>
  Object.values(tag.attributes).find(value => value.uri === uri && value.local === local)?.value;

function xmlEvents(xml: string, open: (tag: SaxesTagNS) => void, close: (tag: SaxesTagNS) => void = () => {}, text: (value: string) => void = () => {}): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('UNSUPPORTED_XML'); });
  parser.on('opentag', open); parser.on('closetag', close); parser.on('text', text); parser.on('cdata', text);
  parser.write(xml).close();
}

type Relation = Readonly<{ type: string; target: string; external: boolean }>;
const relationshipPart = (part: string): string => posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
async function partText(zip: JSZip, name: string): Promise<string> {
  const part = zip.file(name);
  if (!part) throw new Error('MISSING_ARCHIVE_PART');
  return part.async('string');
}
async function relations(zip: JSZip, part: string): Promise<Map<string, Relation>> {
  const name = relationshipPart(part);
  const file = zip.file(name), result = new Map<string, Relation>();
  if (!file) return result;
  xmlEvents(await file.async('string'), tag => {
    if (tag.uri !== PR || tag.local !== 'Relationship') return;
    const id = attr(tag, '', 'Id'), type = attr(tag, '', 'Type'), target = attr(tag, '', 'Target');
    if (!id || !type || !target || result.has(id)) throw new Error('INVALID_RELATIONSHIP');
    result.set(id, { type, target, external: attr(tag, '', 'TargetMode') === 'External' });
  });
  return result;
}
function targetFor(part: string, relation: Relation | undefined, kind: string): string | null {
  if (!relation || relation.external || !relation.type.endsWith(`/${kind}`)) return null;
  const target = posix.normalize(posix.join(posix.dirname(part), relation.target));
  return target.startsWith('xl/') ? target : null;
}

/** Dimensions for display; the shared maintenance validator checks the container. */
function imageInfo(bytes: Buffer): { extension: 'png' | 'jpeg' | 'gif'; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    return width && height ? { extension: 'png', width, height } : null;
  }
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
    return width && height ? { extension: 'gif', width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8) return null;
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      return width && height ? { extension: 'jpeg', width, height } : null;
    }
    offset += length;
  }
  return null;
}

type RawAnchor = {
  kind: AnchorPosition['kind']; from: Record<string, number>; to: Record<string, number>;
  extent: Record<string, number>; pictures: number; embed: string | undefined; unsupported: boolean; hidden: boolean;
};
const DRAWING_ELEMENTS = new Set(['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor', 'from', 'to', 'pos', 'ext',
  'col', 'colOff', 'row', 'rowOff', 'pic', 'nvPicPr', 'cNvPr', 'cNvPicPr', 'blipFill', 'spPr', 'clientData']);
const PICTURE_ELEMENTS = new Set(['blip', 'stretch', 'fillRect', 'xfrm', 'off', 'ext', 'prstGeom', 'avLst', 'picLocks', 'extLst']);
const CREATION_ID_URI = 'http://schemas.microsoft.com/office/drawing/2014/main';
const CREATION_ID_EXT = '{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}';
function drawingAnchors(xml: string): RawAnchor[] {
  const anchors: RawAnchor[] = [], stack: SaxesTagNS[] = [];
  let current: RawAnchor | undefined, capture = '';
  xmlEvents(xml, tag => {
    const parent = stack.at(-1);
    if (tag.uri === D && ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(tag.local)) {
      if (current) throw new Error('INVALID_DRAWING');
      if (tag.local !== 'twoCellAnchor' && tag.local !== 'oneCellAnchor' && tag.local !== 'absoluteAnchor') throw new Error('INVALID_DRAWING');
      current = { kind: tag.local, from: {}, to: {}, extent: {}, pictures: 0, embed: undefined, unsupported: false, hidden: false };
    }
    if (!current && tag.uri === D && ['pic', 'sp', 'grpSp', 'graphicFrame', 'cxnSp'].includes(tag.local)) {
      anchors.push({ kind: 'absoluteAnchor', from: {}, to: {}, extent: {}, pictures: 0, embed: undefined, unsupported: true, hidden: false });
    }
    if (current) {
      if ((tag.uri === D && !DRAWING_ELEMENTS.has(tag.local)) || (tag.uri === A && !PICTURE_ELEMENTS.has(tag.local))
        || (tag.uri !== D && tag.uri !== A && !(tag.uri === CREATION_ID_URI && tag.local === 'creationId'))) current.unsupported = true;
      if (tag.uri === D && tag.local === 'pic') current.pictures++;
      if (tag.uri === D && tag.local === 'cNvPr') {
        const hidden = attr(tag, '', 'hidden');
        if (hidden !== undefined && hidden !== '0' && hidden !== 'false') { current.unsupported = true; current.hidden = true; }
      }
      if (tag.uri === D && ['blipFill', 'spPr'].includes(tag.local)
        && Object.values(tag.attributes).some(value => value.uri !== 'http://www.w3.org/2000/xmlns/')) current.unsupported = true;
      if (tag.uri === A && tag.local === 'extLst' && !(parent?.uri === D && parent.local === 'cNvPr')) current.unsupported = true;
      if (tag.uri === A && tag.local === 'ext' && parent?.uri === A && parent.local === 'extLst'
        && attr(tag, '', 'uri') !== CREATION_ID_EXT) current.unsupported = true;
      if (tag.uri === CREATION_ID_URI && !(parent?.uri === A && parent.local === 'ext'
        && attr(parent, '', 'uri') === CREATION_ID_EXT)) current.unsupported = true;
      if (tag.uri === A && tag.local === 'fillRect' && Object.values(tag.attributes).some(value => value.value !== '0')) current.unsupported = true;
      if (tag.uri === A && tag.local === 'prstGeom' && attr(tag, '', 'prst') !== 'rect') current.unsupported = true;
      if (tag.uri === A && tag.local === 'xfrm' && ['rot', 'flipH', 'flipV'].some(key => {
        const value = attr(tag, '', key); return value !== undefined && value !== '0' && value !== 'false';
      })) current.unsupported = true;
      if (tag.uri === A && tag.local === 'blip') {
        const embed = attr(tag, R, 'embed');
        if (!embed || attr(tag, R, 'link') || current.embed) current.unsupported = true;
        else current.embed = embed;
      }
      if (tag.uri === D && tag.local === 'ext') {
        for (const key of ['cx', 'cy']) { const value = attr(tag, '', key); if (value !== undefined) current.extent[key] = Number(value); }
      }
      if (tag.uri === D && parent?.uri === D && ['from', 'to', 'pos'].includes(parent.local)
        && ['col', 'colOff', 'row', 'rowOff'].includes(tag.local)) capture = '';
      if (tag.uri === D && tag.local === 'pos') {
        for (const key of ['x', 'y']) { const value = attr(tag, '', key); if (value !== undefined) current.from[key] = Number(value); }
      }
    }
    stack.push(tag);
  }, tag => {
    const parent = stack.at(-2);
    if (current && tag.uri === D && parent?.uri === D && ['from', 'to'].includes(parent.local)
      && ['col', 'colOff', 'row', 'rowOff'].includes(tag.local)) {
      const value = Number(capture);
      if (!/^\d+$/u.test(capture) || !Number.isSafeInteger(value)) current.unsupported = true;
      else (parent.local === 'from' ? current.from : current.to)[tag.local] = value;
    }
    if (current && tag.uri === D && tag.local === current.kind) {
      const required = current.kind === 'absoluteAnchor' ? ['x', 'y'] : ['col', 'colOff', 'row', 'rowOff'];
      if (required.some(key => !Number.isSafeInteger(current?.from[key]) || (current?.from[key] ?? -1) < 0)) current.unsupported = true;
      if (current.kind === 'twoCellAnchor' && ['col', 'colOff', 'row', 'rowOff'].some(key => !Number.isSafeInteger(current?.to[key]) || (current?.to[key] ?? -1) < 0)) current.unsupported = true;
      if (current.kind !== 'twoCellAnchor' && ['cx', 'cy'].some(key => !Number.isSafeInteger(current?.extent[key]) || (current?.extent[key] ?? 0) <= 0)) current.unsupported = true;
      anchors.push(current); current = undefined;
    }
    stack.pop();
  }, value => { capture += value; });
  if (current) throw new Error('INVALID_DRAWING');
  return anchors;
}

function sourceText(value: ExcelJS.CellValue): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)
    && value.richText.every(part => typeof part.text === 'string')) return value.richText.map(part => part.text).join('');
  return null;
}

/** Read-only, bounded source inventory. It is not a runtime import format. */
export async function inspectSyntheticSopSource(bytes: Buffer): Promise<InspectedSource> {
  return inspectSyntheticSource(bytes);
}

/** Inspect image-preview labels and all objects without counting unrelated text as source text. */
export async function inspectSyntheticSopImagePreview(bytes: Buffer): Promise<InspectedSource> {
  return inspectSyntheticSource(bytes, '图片盘点预览');
}

async function inspectSyntheticSource(bytes: Buffer, textSheet?: string): Promise<InspectedSource> {
  await inspectArchive(bytes, { allowExternalHyperlinks: true });
  const zip = await JSZip.loadAsync(bytes);
  const core = zip.file('docProps/core.xml');
  if (!core) throw new Error('SYNTHETIC_MARKER_REQUIRED');
  let creator = '', creatorCount = 0, readingCreator = false;
  xmlEvents(await core.async('string'), tag => {
    if (tag.uri === 'http://purl.org/dc/elements/1.1/' && tag.local === 'creator') { readingCreator = true; creatorCount++; }
  }, tag => {
    if (tag.uri === 'http://purl.org/dc/elements/1.1/' && tag.local === 'creator') readingCreator = false;
  }, text => { if (readingCreator) creator += text; });
  if (creatorCount !== 1 || creator !== SYNTHETIC_SOURCE_CREATOR) throw new Error('SYNTHETIC_MARKER_REQUIRED');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  if (book.creator !== SYNTHETIC_SOURCE_CREATOR) throw new Error('SYNTHETIC_MARKER_REQUIRED');
  const objects: SourceObject[] = [], images = new Map<string, Buffer>();
  const sheets: { name: string; merges: string[] }[] = [], usedParts = new Set<string>();
  let unsupportedIndex = 0, textChars = 0, placementBytes = 0, placementCount = 0;
  const add = (item: SourceObject): void => { if (objects.length >= MAX_OBJECTS) throw new Error('SOURCE_OBJECT_LIMIT'); objects.push(item); };
  const unsupported = (sheet: string, location: string, reason: string, rawText?: string): void => {
    add({ kind: 'unsupported', id: `u:${++unsupportedIndex}`, sheet, location, reason, ...(rawText === undefined ? {} : { rawText }) });
  };
  const workbookRelations = await relations(zip, 'xl/workbook.xml');
  usedParts.add(relationshipPart('xl/workbook.xml'));
  const sheetRefs: { name: string; relation: string }[] = [];
  xmlEvents(await partText(zip, 'xl/workbook.xml'), tag => {
    if (tag.uri === S && tag.local === 'sheet') {
      const name = attr(tag, '', 'name'), relation = attr(tag, R, 'id');
      if (!name || !relation) throw new Error('INVALID_WORKBOOK_SHEETS');
      sheetRefs.push({ name, relation });
    }
    if (tag.uri === S && ['definedNames', 'externalReferences', 'pivotCaches'].includes(tag.local)) {
      unsupported('', 'xl/workbook.xml', `未支持的工作簿内容：${tag.local}`);
    }
  });
  if (sheetRefs.length !== book.worksheets.length || new Set(sheetRefs.map(x => x.name)).size !== sheetRefs.length) throw new Error('INVALID_WORKBOOK_SHEETS');
  const usedWorkbookRelations = new Set(sheetRefs.map(item => item.relation));
  for (const [id, relation] of workbookRelations) {
    if (!usedWorkbookRelations.has(id) && !['styles', 'theme', 'sharedStrings'].some(kind => relation.type.endsWith(`/${kind}`))) {
      unsupported('', 'xl/_rels/workbook.xml.rels', '存在未识别的工作簿关系');
    }
  }

  async function addImage(sheet: string, id: string, location: string, kind: SourceImage['kind'], position: AnchorPosition | null, part: string, relation: Relation | undefined): Promise<void> {
    const target = targetFor(part, relation, 'image');
    const file = target?.startsWith('xl/media/') ? zip.file(target) : null;
    if (!target || !file) { unsupported(sheet, location, '图片关系缺失或不受支持'); return; }
    usedParts.add(target);
    const data = await file.async('nodebuffer'), info = imageInfo(data);
    const gif = isSopGif(posix.extname(target).slice(1), data);
    if (!info || data.length > P.oneMediaBytes || !imageMime(data, info.extension) || (gif && info.extension !== 'gif')) {
      unsupported(sheet, location, gif ? SOP_GIF_UNSUPPORTED_FIX : '图片容器、尺寸或字节超出支持范围'); return;
    }
    placementBytes += data.length;
    if (++placementCount > P.mediaCount || placementBytes > P.mediaBytes) throw new Error('SOURCE_MEDIA_LIMIT');
    const reviewWarnings = [...(gif ? [SOP_GIF_UNSUPPORTED_FIX] : []), '图片未完整解码', kind === 'image'
      ? '图片原放置比例未核对，预览及维护表按像素比例缩放' : '原背景显示方式未保留'];
    const item: SourceImage = { kind, id, sheet, location, position, sha256: digest(data), ...info, reviewWarnings };
    images.set(id, data); add(item);
  }

  for (const [sheetIndex, ref] of sheetRefs.entries()) {
    const sheet = book.getWorksheet(ref.name), part = targetFor('xl/workbook.xml', workbookRelations.get(ref.relation), 'worksheet');
    if (!sheet || !part || !zip.file(part) || usedParts.has(part)) throw new Error('INVALID_WORKBOOK_SHEETS');
    usedParts.add(part);
    const sheetRelations = await relations(zip, part), drawingIds: string[] = [], backgroundIds: string[] = [], cellRefs: string[] = [], merges: string[] = [];
    usedParts.add(relationshipPart(part));
    const foreignNamespaces = new Set<string>();
    let cell: { ref: string; hasData: boolean } | undefined;
    let headerFooter: { name: string; text: string } | undefined;
    xmlEvents(await partText(zip, part), tag => {
      if (tag.uri !== S) {
        if (!foreignNamespaces.has(tag.uri)) { foreignNamespaces.add(tag.uri); unsupported(ref.name, part, '工作表包含未支持的扩展内容'); }
        return;
      }
      if (tag.local === 'c') { const refValue = attr(tag, '', 'r'); if (!refValue || cell) throw new Error('INVALID_CELL'); cell = { ref: refValue, hasData: false }; }
      if (['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'].includes(tag.local)) {
        if (headerFooter) throw new Error('INVALID_HEADER_FOOTER');
        headerFooter = { name: tag.local, text: '' };
      }
      if (cell && ['v', 'f', 'is'].includes(tag.local)) cell.hasData = true;
      if (tag.local === 'mergeCell') { const value = attr(tag, '', 'ref'); if (!value) throw new Error('INVALID_MERGE'); merges.push(value); }
      if (tag.local === 'drawing' || tag.local === 'picture') {
        const id = attr(tag, R, 'id');
        if (!id) unsupported(ref.name, part, '绘图或背景缺少关系');
        else (tag.local === 'drawing' ? drawingIds : backgroundIds).push(id);
      }
      if (['legacyDrawing', 'legacyDrawingHF', 'oleObjects', 'controls', 'tableParts', 'hyperlinks', 'extLst'].includes(tag.local)) {
        unsupported(ref.name, part, `未支持的工作表内容：${tag.local}`);
      }
    }, tag => {
      if (tag.uri === S && tag.local === 'c' && cell) { if (cell.hasData) cellRefs.push(cell.ref); cell = undefined; }
      if (tag.uri === S && headerFooter?.name === tag.local) {
        if (headerFooter.text.length) {
          if (!textSheet || ref.name === textSheet) {
            textChars += headerFooter.text.length;
            if (textChars > P.normalizedTextChars) throw new Error('SOURCE_TEXT_LIMIT');
          }
          unsupported(ref.name, `${part}#${tag.local}`, '页眉或页脚文本尚不支持转换，需回看来源', headerFooter.text);
        }
        headerFooter = undefined;
      }
    }, text => { if (headerFooter) headerFooter.text += text; });
    const excelMerges = sheet.model.merges ?? [];
    if (JSON.stringify([...merges].sort()) !== JSON.stringify([...excelMerges].sort())) throw new Error('MERGE_MISMATCH');
    sheets.push({ name: ref.name, merges });
    for (const address of cellRefs) {
      const item = sheet.getCell(address);
      if (item.master.address !== address) { unsupported(ref.name, address, '合并区从属格含独立数据'); continue; }
      const text = sourceText(item.value);
      if (text === null) { unsupported(ref.name, address, '非文本单元格、公式或链接对象'); continue; }
      if (!text.length || (textSheet && ref.name !== textSheet)) continue;
      textChars += text.length;
      if (textChars > P.normalizedTextChars) throw new Error('SOURCE_TEXT_LIMIT');
      add({ kind: 'text', id: `c:${sheetIndex + 1}:${address}`, sheet: ref.name, cell: address, text, codePoints: Array.from(text).length });
    }
    for (const [index, id] of backgroundIds.entries()) {
      await addImage(ref.name, `b:${sheetIndex + 1}:${index + 1}`, '工作表背景', 'background', null, part, sheetRelations.get(id));
    }
    for (const [drawingIndex, id] of drawingIds.entries()) {
      const drawing = targetFor(part, sheetRelations.get(id), 'drawing');
      if (!drawing || !zip.file(drawing)) { unsupported(ref.name, part, '绘图关系缺失或不受支持'); continue; }
      usedParts.add(drawing);
      usedParts.add(relationshipPart(drawing));
      const drawingRelations = await relations(zip, drawing), anchors = drawingAnchors(await partText(zip, drawing));
      for (const [index, anchor] of anchors.entries()) {
        const location = `${drawing}#${index + 1}`;
        if (anchor.unsupported || anchor.pictures !== 1 || !anchor.embed) {
          unsupported(ref.name, location, anchor.hidden ? '源图片标记为隐藏或隐藏状态不明，须回看原表' : '图形、裁切、图片效果或锚点不受支持');
          continue;
        }
        const position: AnchorPosition = { kind: anchor.kind, from: anchor.from, to: anchor.to, extent: anchor.extent };
        await addImage(ref.name, `p:${sheetIndex + 1}:${drawingIndex + 1}:${index + 1}`, location, 'image', position, drawing, drawingRelations.get(anchor.embed));
      }
      const referenced = new Set(anchors.map(anchor => anchor.embed).filter(value => value !== undefined));
      for (const relationId of drawingRelations.keys()) if (!referenced.has(relationId)) {
        unsupported(ref.name, drawing, '存在未识别的绘图关系');
      }
    }
    const referenced = new Set([...drawingIds, ...backgroundIds]);
    for (const relationId of sheetRelations.keys()) if (!referenced.has(relationId)) {
      unsupported(ref.name, part, '存在未识别的工作表关系');
    }
  }
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]?.dir) continue;
    if (/^xl\/(?:worksheets\/[^/]+\.xml|drawings\/[^/]+\.xml|(?:worksheets|drawings)\/_rels\/[^/]+\.rels|media\/[^/]+)$/u.test(name) && !usedParts.has(name)) {
      const part = name.startsWith('xl/media/') ? zip.file(name) : null;
      const data = part ? await part.async('nodebuffer') : undefined;
      unsupported('', name, isSopGif(posix.extname(name).slice(1), data)
        ? `未关联图片资源：${SOP_GIF_UNSUPPORTED_FIX}` : '未关联的工作表、绘图或媒体');
    } else if (!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/[^/]+\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|theme\/[^/]+\.xml|worksheets\/[^/]+\.xml|worksheets\/_rels\/[^/]+\.rels|drawings\/[^/]+\.xml|drawings\/_rels\/[^/]+\.rels|media\/[^/]+))$/u.test(name)) {
      unsupported('', name, '未支持的工作簿部件');
    }
  }
  return { inventory: { version: SOURCE_INVENTORY_VERSION, sourceSha256: digest(bytes), publishable: false, sheets, objects }, images };
}
