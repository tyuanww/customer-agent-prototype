import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { imageMime, parseSopMaintenance } from '../src/maintenance.js';
import { runSyntheticSourceCli } from '../src/sop-source-cli.js';
import { buildSyntheticSopDraft, checkSyntheticSopSourceDraft, createSourceDecisionTemplate, SOURCE_DECISIONS_VERSION } from '../src/sop-source-draft.js';
import { inspectSyntheticSopSource, SYNTHETIC_SOURCE_CREATOR, type InspectedSource } from '../src/sop-source-inventory.js';
import { createSyntheticSourcePreview } from '../src/sop-source-preview.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAABMhMSH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAQAAACwAAAAAAQABAAACAkQBADs=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCABRwt/9k=', 'base64');
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function sourceWorkbook(options: { marker?: boolean; formula?: boolean; extraSheet?: boolean; headerFooter?: boolean;
  imageBytes?: Buffer; imageExtension?: 'png' | 'jpeg' | 'gif'; stretched?: boolean; noImages?: boolean } = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = options.marker === false ? 'not-marked' : SYNTHETIC_SOURCE_CREATOR;
  const sheet = book.addWorksheet('合成原表');
  sheet.mergeCells('A2:A3');
  sheet.getCell('A2').value = '合成场景';
  sheet.getCell('B2').value = { richText: [{ text: '合成第一行\n  ' }, { text: '保留空格' }] };
  sheet.getCell('C2').value = '合成😀原文';
  sheet.getCell('D4').value = '合成处理完成';
  sheet.getCell('D10').value = '合成请求协助';
  if (options.headerFooter) sheet.headerFooter = { oddHeader: '&L合成页眉', oddFooter: '&R合成页脚', evenHeader: '  ' };
  if (options.formula) sheet.getCell('E2').value = { formula: '1+1', result: 2 };
  if (!options.noImages) {
    const id = book.addImage({ buffer: new Uint8Array(options.imageBytes ?? png).buffer, extension: options.imageExtension ?? 'png' });
    if (options.stretched) sheet.addImage(id, { tl: { col: 3, row: 1 }, ext: { width: 120, height: 20 } });
    else sheet.addImage(id, 'D2:E3');
    sheet.addImage(id, 'G4:AR12');
    sheet.addBackgroundImage(id);
  }
  if (options.extraSheet) book.addWorksheet('合成另一表').getCell('B1').value = '合成另一表原文';
  return Buffer.from(await book.xlsx.writeBuffer());
}

function sourceRef(source: InspectedSource, sourceId: string, start = 0, end?: number) {
  const item = source.inventory.objects.find(object => object.id === sourceId);
  if (!item || item.kind !== 'text') throw new Error('Synthetic text missing');
  return { from: [{ sourceId, start, end: end ?? item.codePoints }] };
}
function choices(source: InspectedSource, options: { pendingSecondImage?: boolean; missingBranch?: boolean } = {}) {
  const decisions = source.inventory.objects.map(item => {
    if (item.kind === 'text') {
      const segments = item.id === 'c:1:C2'
        ? [{ start: 0, end: 2, disposition: 'mapped' }, { start: 2, end: item.codePoints, disposition: 'mapped' }]
        : [{ start: 0, end: item.codePoints, disposition: 'mapped' }];
      return { sourceId: item.id, segments };
    }
    if (item.kind === 'unsupported') return { sourceId: item.id, disposition: 'pending' };
    if (item.kind === 'background') return { sourceId: item.id, disposition: 'excluded', reason: '合成背景明确排除' };
    return { sourceId: item.id, disposition: options.pendingSecondImage && item.id === 'p:1:1:2' ? 'pending' : 'mapped' };
  });
  const review = { 维护状态: '待发布', 业务确认人: '合成确认人' };
  const task = { 记录类型: '任务', 场景编号: 'SC-1', 确认项配置: '无确认项', 可见对象: '坐席可读', ...review };
  const sourceOrigin = { kind: 'source' }, newOrigin = { kind: 'new', reason: '合成场景人工指定关系' };
  const rows: unknown[] = [
    { key: 'scene', sheet: '场景目录', origin: sourceOrigin, fields: { ...review, 场景编号: 'SC-1', 场景名称: sourceRef(source, 'c:1:A2'), 适用范围: '合成范围', 起始任务编号: 'TASK-1', 入口词: '合成入口' } },
    { key: 'task1', sheet: '执行任务', origin: sourceOrigin, fields: { ...task, 任务编号: 'TASK-1', 阶段: '判断', 任务名称: '合成判断', 任务类型: '判断', 操作要求: sourceRef(source, 'c:1:B2'), 关联知识编号: 'KNOW-1', 关联资源编号: options.pendingSecondImage ? 'RES-1' : 'RES-1,RES-2' } },
    { key: 'task2', sheet: '执行任务', origin: sourceOrigin, fields: { ...task, 任务编号: 'TASK-2', 阶段: '结束', 任务名称: '合成完成', 任务类型: '终点', 操作要求: sourceRef(source, 'c:1:D4') } },
    { key: 'task3', sheet: '执行任务', origin: sourceOrigin, fields: { ...task, 任务编号: 'TASK-3', 阶段: '协助', 任务名称: '合成协助', 任务类型: '终点', 操作要求: sourceRef(source, 'c:1:D10') } },
    { key: 'branch1', sheet: '判断分支', origin: newOrigin, fields: { ...review, 分支编号: 'BR-1', 任务编号: 'TASK-1', 选项: '合成选项', 判断依据: '合成依据', 目标任务编号: options.missingBranch ? 'MISSING' : 'TASK-2', 是否无法判断: '否', 匹配词: '不设置', 分支顺序: '1' } },
    { key: 'branch2', sheet: '判断分支', origin: newOrigin, fields: { ...review, 分支编号: 'BR-2', 任务编号: 'TASK-1', 选项: '无法判断', 判断依据: '合成依据', 目标任务编号: 'TASK-3', 是否无法判断: '是', 匹配词: '不设置', 分支顺序: '2' } },
    { key: 'knowledge', sheet: '知识与案例', origin: sourceOrigin, fields: { ...review, 知识编号: 'KNOW-1', 标题: '合成知识', 正文: sourceRef(source, 'c:1:C2', 0, 2), 可见对象: '坐席可读' } },
    { key: 'script', sheet: '客户话术', origin: sourceOrigin, fields: { ...review, 话术编号: 'SCRIPT-1', 话术标题: '合成话术', 对客正文: sourceRef(source, 'c:1:C2', 2) } },
    { key: 'link', sheet: '执行任务', origin: newOrigin, fields: { ...review, 记录类型: '话术引用', 关联编号: 'LINK-1', 任务编号: 'TASK-1', 话术编号: 'SCRIPT-1', 适用条件: '合成条件', 话术关系: '独立' } },
    { key: 'resource1', sheet: '资源与图片', origin: sourceOrigin, fields: { ...review, 资源编号: 'RES-1', 资源类型: '图片', 资源名称: '合成图片一', 可见对象: '坐席可读', 适用范围: '合成范围' }, imageSourceId: 'p:1:1:1' },
  ];
  if (!options.pendingSecondImage) rows.push({ key: 'resource2', sheet: '资源与图片', origin: sourceOrigin, fields: { ...review, 资源编号: 'RES-2', 资源类型: '图片', 资源名称: '合成图片二', 可见对象: '坐席可读', 适用范围: '合成范围' }, imageSourceId: 'p:1:1:2' });
  return { version: SOURCE_DECISIONS_VERSION, sourceSha256: source.inventory.sourceSha256, decisions, rows };
}

function choicesWithoutImages(source: InspectedSource) {
  const input = choices(source);
  const rows = input.rows.filter(value => typeof value === 'object' && value !== null && 'key' in value
    && value.key !== 'resource1' && value.key !== 'resource2').map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 关联资源编号: '' } };
  });
  return { ...input, rows };
}

it('inventories merged cells, rich text, independent placements and backgrounds without inferring ownership', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  expect(source.inventory.sourceSha256).toBe(digest(bytes));
  expect(source.inventory.sheets).toEqual([{ name: '合成原表', merges: ['A2:A3'] }]);
  expect(source.inventory.objects.filter(item => item.kind === 'text')).toHaveLength(5);
  expect(source.inventory.objects.find(item => item.id === 'c:1:B2')).toMatchObject({ text: '合成第一行\n  保留空格' });
  expect(source.inventory.objects.find(item => item.id === 'c:1:A3')).toBeUndefined();
  const images = source.inventory.objects.filter(item => item.kind === 'image');
  expect(images).toHaveLength(2);
  expect(images[0]).toMatchObject({ id: 'p:1:1:1', sha256: digest(png) });
  expect(images[1]).toMatchObject({ id: 'p:1:1:2', sha256: digest(png), position: { from: { col: 6, row: 3 }, to: { col: 44, row: 12 } } });
  expect(source.inventory.objects.filter(item => item.kind === 'background')).toHaveLength(1);
  expect(source.inventory.objects.filter(item => item.kind === 'unsupported')).toEqual([]);
  expect(source.images.get('p:1:1:1')).toEqual(source.images.get('p:1:1:2'));
  expect(source.images.get('b:1:1')).toEqual(png);
  expect(JSON.stringify(createSourceDecisionTemplate(source))).not.toContain('合成第一行');
});

it('copies selected text and image bytes while keeping image decoding and display pending', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const draft = await buildSyntheticSopDraft(bytes, choices(source));
  const directory = await mkdtemp(join(tmpdir(), 'sop-source-synthetic-'));
  try {
    const path = join(directory, 'maintenance.xlsx');
    await writeFile(path, draft.workbook, { flag: 'wx', mode: 0o600 });
    const saved = await readFile(path), parsed = await parseSopMaintenance(saved);
    expect(digest(saved)).toBe(draft.report.workbookSha256);
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
    expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false, images: 2 });
    expect(parsed.document.tasks.find(item => item.id === 'TASK-1')?.instruction).toBe('合成第一行\n  保留空格');
    expect(parsed.document.knowledge[0]?.body).toBe('合成');
    expect(parsed.document.scripts[0]?.answerText).toBe('😀原文');
    expect(parsed.document.branches.find(item => item.id === 'BR-2')).toMatchObject({ targetTaskId: 'TASK-3', unableToDetermine: true });
    for (const resource of parsed.document.resources) {
      if (resource.kind !== 'image') throw new Error('Synthetic image missing');
      expect(resource.images[0]?.bytes).toEqual(png);
      expect(resource.images[0]?.sha256).toBe(digest(png));
    }
    expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false,
      counts: { objects: 8, segments: 9, mapped: 8, excluded: 1, pending: 0, unsupported: 0, imagesNeedingReview: 3 } });
    expect(draft.report.ledger.find(item => item.sourceId === 'c:1:C2')?.segments).toEqual([
      expect.objectContaining({ start: 0, end: 2, targets: ['knowledge.正文'] }),
      expect.objectContaining({ start: 2, end: 5, targets: ['script.对客正文'] }),
    ]);
    expect(draft.report.targets.find(item => item.key === 'branch2')).toMatchObject({ businessId: 'BR-2', origin: 'new', reason: '合成场景人工指定关系' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('keeps pending images in the source ledger and never claims completeness', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const decisions = choices(source, { pendingSecondImage: true });
  const draft = await buildSyntheticSopDraft(bytes, decisions);
  expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false, counts: { pending: 1 } });
  expect(draft.report.ledger.find(item => item.sourceId === 'p:1:1:2')?.segments[0]).toMatchObject({ disposition: 'pending', targets: [] });
  const parsed = await parseSopMaintenance(draft.workbook);
  expect(parsed.report).toMatchObject({ status: 'needs-review', images: 1 });
  expect(parsed.report.issues.map(issue => issue.code)).toContain('OPEN_QUESTION');
  const checked = await checkSyntheticSopSourceDraft({ source: bytes, decisions, workbook: draft.workbook });
  expect(checked).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', workbookMatchesMapping: true });
  expect(checked.reasons).toEqual(expect.arrayContaining(['PENDING_SOURCES', 'IMAGE_REVIEW_REQUIRED']));
});

it.each(['intact', 'corrupted'] as const)(
  'does not treat %s source images as reconciled after the generated notice is removed', async variant => {
    const image = Buffer.from(png);
    if (variant === 'corrupted') {
      const tag = image.indexOf(Buffer.from('IDAT'));
      const length = image.readUInt32BE(tag - 4), dataStart = tag + 4;
      image[dataStart] = 0;
      image.writeUInt32BE(crc32(image.subarray(tag, dataStart + length)), dataStart + length);
      expect(imageMime(image, 'png')).toBe('image/png');
      expect(() => inflateSync(image.subarray(dataStart, dataStart + length))).toThrow();
    }
    const bytes = await sourceWorkbook({ imageBytes: image }), source = await inspectSyntheticSopSource(bytes);
    const decisions = choices(source), draft = await buildSyntheticSopDraft(bytes, decisions);
    expect(draft.report.mappingComplete).toBe(false);
    expect(draft.report.maintenance.status).toBe('needs-review');
    const edited = new ExcelJS.Workbook();
    await edited.xlsx.load(new Uint8Array(draft.workbook).buffer);
    const scene = edited.getWorksheet('场景目录');
    if (!scene) throw new Error('Synthetic scene missing');
    const noticeColumn = scene.getRow(2).values;
    if (!Array.isArray(noticeColumn)) throw new Error('Synthetic headers missing');
    const column = noticeColumn.indexOf('待确认事项');
    if (column < 1) throw new Error('Synthetic notice missing');
    scene.getRow(3).getCell(column).value = null;
    const rechecked = await checkSyntheticSopSourceDraft({ source: bytes, decisions, workbook: Buffer.from(await edited.xlsx.writeBuffer()) });
    expect(rechecked).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', workbookMatchesMapping: false,
      maintenance: { status: 'reviewed', sourceCheck: 'not-checked' } });
    expect(rechecked.reasons).toEqual(expect.arrayContaining(['WORKBOOK_CHANGED', 'IMAGE_REVIEW_REQUIRED']));
    expect(rechecked.counts.imagesNeedingReview).toBeGreaterThan(0);
  });

it('registers all nonempty header/footer text as unsupported source locations and blocks a separately checked draft', async () => {
  const bytes = await sourceWorkbook({ headerFooter: true }), source = await inspectSyntheticSopSource(bytes);
  const unsupported = source.inventory.objects.filter(item => item.kind === 'unsupported');
  expect(unsupported).toEqual(expect.arrayContaining([
    expect.objectContaining({ location: expect.stringContaining('#oddHeader'), rawText: '&L合成页眉' }),
    expect.objectContaining({ location: expect.stringContaining('#oddFooter'), rawText: '&R合成页脚' }),
    expect.objectContaining({ location: expect.stringContaining('#evenHeader'), rawText: '  ' }),
  ]));
  const preview = new ExcelJS.Workbook();
  await preview.xlsx.load(new Uint8Array(await createSyntheticSourcePreview(source)).buffer);
  const previewRows = preview.getWorksheet('文字盘点预览')?.getColumn(3).values;
  expect(previewRows).toContainEqual(expect.stringContaining('&L合成页眉'));
  expect(previewRows).toContainEqual(expect.stringContaining('&R合成页脚'));
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId.startsWith('u:')
    ? { sourceId: item.sourceId, disposition: 'excluded', reason: '合成人工排除' } : item);
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions });
  expect(draft.report).toMatchObject({ mappingComplete: false, counts: { pending: 0, unsupported: 3 } });
  const parsed = await parseSopMaintenance(draft.workbook);
  expect(parsed.report.status).toBe('needs-review');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('OPEN_QUESTION');
});

it.each(['alphaRepl', 'futureSyntheticEffect'])('marks unknown picture effect %s as unsupported', async effect => {
  const zip = await JSZip.loadAsync(await sourceWorkbook()), drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  const xml = await drawing.async('string');
  zip.file('xl/drawings/drawing1.xml', xml.replace(/<a:blip([^>]*)\/>/u, `<a:blip$1><a:${effect} val="50000"/></a:blip>`));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), source = await inspectSyntheticSopSource(bytes);
  expect(source.inventory.objects).toContainEqual(expect.objectContaining({
    kind: 'unsupported', location: 'xl/drawings/drawing1.xml#1', reason: expect.stringContaining('图片'),
  }));
  expect(source.inventory.objects.find(item => item.id === 'p:1:1:1')).toBeUndefined();
  expect(source.inventory.objects.find(item => item.id === 'p:1:1:2')).toMatchObject({ kind: 'image' });
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId.startsWith('u:')
    ? { sourceId: item.sourceId, disposition: 'excluded', reason: '合成人工排除' } : item);
  const rows = input.rows.filter(value => typeof value === 'object' && value !== null && 'key' in value && value.key !== 'resource1').map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 关联资源编号: 'RES-2' } };
  });
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions, rows });
  expect(draft.report).toMatchObject({ mappingComplete: false, counts: { pending: 0, unsupported: 1 } });
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('needs-review');
});

it('marks picture display attributes outside the supported set for review', async () => {
  const zip = await JSZip.loadAsync(await sourceWorkbook()), drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  zip.file('xl/drawings/drawing1.xml', (await drawing.async('string')).replace('<xdr:spPr>', '<xdr:spPr bwMode="gray">'));
  const source = await inspectSyntheticSopSource(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(source.inventory.objects).toContainEqual(expect.objectContaining({
    kind: 'unsupported', location: 'xl/drawings/drawing1.xml#1', reason: expect.stringContaining('图片'),
  }));
});

it('marks a CRC-valid PNG with a broken IDAT stream as unverified through the generated maintenance file', async () => {
  const corrupt = Buffer.from(png), tag = corrupt.indexOf(Buffer.from('IDAT'));
  const length = corrupt.readUInt32BE(tag - 4), dataStart = tag + 4;
  corrupt[dataStart] = 0;
  corrupt.writeUInt32BE(crc32(corrupt.subarray(tag, dataStart + length)), dataStart + length);
  expect(imageMime(corrupt, 'png')).toBe('image/png');
  expect(() => inflateSync(corrupt.subarray(dataStart, dataStart + length))).toThrow();
  const bytes = await sourceWorkbook({ imageBytes: corrupt }), source = await inspectSyntheticSopSource(bytes);
  expect(source.images.get('p:1:1:1')).toEqual(corrupt);
  expect(source.inventory.objects.find(item => item.id === 'p:1:1:1')).toMatchObject({
    reviewWarnings: expect.arrayContaining(['图片未完整解码']),
  });
  const draft = await buildSyntheticSopDraft(bytes, choices(source));
  expect(draft.report).toMatchObject({ mappingComplete: false, counts: { imagesNeedingReview: 3 } });
  const parsed = await parseSopMaintenance(draft.workbook);
  expect(parsed.report.status).toBe('needs-review');
  expect(parsed.report.issues.map(issue => issue.code)).toContain('OPEN_QUESTION');
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.document.scenes[0]?.review.pendingText).toContain('未完整解码');
  expect(parsed.document.scenes[0]?.review.pendingText).toContain('原显示可能变化');
  const resource = parsed.document.resources.find(item => item.id === 'RES-1');
  expect(resource?.kind === 'image' && resource.images[0]?.bytes.equals(corrupt)).toBe(true);
});

it('records a hidden source picture as unsupported instead of treating it as visible', async () => {
  const zip = await JSZip.loadAsync(await sourceWorkbook()), drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  zip.file('xl/drawings/drawing1.xml', (await drawing.async('string')).replace('<xdr:cNvPr id="1"', '<xdr:cNvPr hidden="1" id="1"'));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), source = await inspectSyntheticSopSource(bytes);
  expect(source.inventory.objects.find(item => item.id === 'p:1:1:1')).toBeUndefined();
  expect(source.inventory.objects).toContainEqual(expect.objectContaining({
    kind: 'unsupported', location: 'xl/drawings/drawing1.xml#1', reason: expect.stringContaining('隐藏'),
  }));
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId.startsWith('u:')
    ? { sourceId: item.sourceId, disposition: 'excluded', reason: '合成人工排除' } : item);
  const rows = input.rows.filter(value => typeof value === 'object' && value !== null && 'key' in value && value.key !== 'resource1').map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 关联资源编号: 'RES-2' } };
  });
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions, rows });
  expect(draft.report.mappingComplete).toBe(false);
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('needs-review');
});

it('retains the source anchor and flags a stretched placement whose output uses pixel proportions', async () => {
  const bytes = await sourceWorkbook({ stretched: true }), source = await inspectSyntheticSopSource(bytes);
  expect(source.inventory.objects.find(item => item.id === 'p:1:1:1')).toMatchObject({
    width: 1, height: 1, position: { kind: 'oneCellAnchor', extent: { cx: 1_143_000, cy: 190_500 } },
    reviewWarnings: expect.arrayContaining(['图片原放置比例未核对，预览及维护表按像素比例缩放']),
  });
  const preview = new ExcelJS.Workbook();
  await preview.xlsx.load(new Uint8Array(await createSyntheticSourcePreview(source)).buffer);
  expect(preview.getWorksheet('图片盘点预览')?.getRow(4).getCell(7).value).toContain('放置比例');
  expect(preview.getWorksheet('图片盘点预览')?.getImages()[1]?.range).toMatchObject({ ext: { width: 1, height: 1 } });
  const draft = await buildSyntheticSopDraft(bytes, choices(source));
  expect(draft.report.ledger.find(item => item.sourceId === 'p:1:1:1')).toMatchObject({
    position: { extent: { cx: 1_143_000, cy: 190_500 } }, reviewWarnings: expect.arrayContaining([expect.stringContaining('放置比例')]),
  });
  expect(draft.report.mappingComplete).toBe(false);
  const maintenance = new ExcelJS.Workbook();
  await maintenance.xlsx.load(new Uint8Array(draft.workbook).buffer);
  expect(maintenance.getWorksheet('资源与图片')?.getImages()[0]?.range).toMatchObject({ ext: { width: 1, height: 1 } });
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('needs-review');
});

it('does not accept truncated PNG containers for a placement or a background', async () => {
  const zip = await JSZip.loadAsync(await sourceWorkbook());
  zip.file('xl/media/image1.png', png.subarray(0, 24));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), source = await inspectSyntheticSopSource(bytes);
  expect(source.images.size).toBe(0);
  expect(source.inventory.objects.filter(item => item.kind === 'unsupported')).toEqual(expect.arrayContaining([
    expect.objectContaining({ location: '工作表背景', reason: expect.stringContaining('图片') }),
    expect.objectContaining({ location: 'xl/drawings/drawing1.xml#1', reason: expect.stringContaining('图片') }),
    expect.objectContaining({ location: 'xl/drawings/drawing1.xml#2', reason: expect.stringContaining('图片') }),
  ]));
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId.startsWith('u:')
    ? { sourceId: item.sourceId, disposition: 'excluded', reason: '合成人工排除' } : item);
  const rows = input.rows.filter(value => typeof value === 'object' && value !== null && 'key' in value
    && value.key !== 'resource1' && value.key !== 'resource2').map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 关联资源编号: '' } };
  });
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions, rows });
  expect(draft.report).toMatchObject({ mappingComplete: false, counts: { pending: 0, unsupported: 3 } });
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('needs-review');
});

it('supports an explicitly chosen background as its own resource', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId === 'b:1:1'
    ? { sourceId: item.sourceId, disposition: 'mapped' } : item);
  const rows = [...input.rows, { key: 'background', sheet: '资源与图片', imageSourceId: 'b:1:1', origin: { kind: 'source' },
    fields: { 资源编号: 'RES-3', 资源类型: '图片', 资源名称: '合成背景', 可见对象: '坐席可读',
      适用范围: '合成范围', 维护状态: '待发布', 业务确认人: '合成确认人' } }];
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions, rows });
  const parsed = await parseSopMaintenance(draft.workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  const resource = parsed.document.resources.find(item => item.id === 'RES-3');
  expect(resource?.kind).toBe('image');
  if (!resource || resource.kind !== 'image') throw new Error('Synthetic background missing');
  expect(resource.images[0]?.bytes).toEqual(png);
  expect(draft.report.ledger.find(item => item.sourceId === 'b:1:1')).toMatchObject({ kind: 'background', mediaSha256: digest(png), segments: [{ targets: ['background.图片'] }] });
});

it('accounts for an unconfirmed part of a split source cell', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const input = choices(source);
  const decisions = input.decisions.map(item => item.sourceId === 'c:1:C2'
    ? { sourceId: item.sourceId, segments: [{ start: 0, end: 2, disposition: 'mapped' }, { start: 2, end: 5, disposition: 'pending' }] } : item);
  const rows = input.rows.filter(row => typeof row === 'object' && row !== null && 'key' in row && row.key !== 'script' && row.key !== 'link');
  const draft = await buildSyntheticSopDraft(bytes, { ...input, decisions, rows });
  expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false, counts: { pending: 1 } });
  expect(draft.report.ledger.find(item => item.sourceId === 'c:1:C2')?.segments).toEqual([
    expect.objectContaining({ start: 0, end: 2, disposition: 'mapped' }),
    expect.objectContaining({ start: 2, end: 5, disposition: 'pending', targets: [] }),
  ]);
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('needs-review');
});

it('preserves an existing review question when the source still has pending material', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const input = choices(source, { pendingSecondImage: true });
  const rows = input.rows.map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'scene' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 待确认事项: '原有合成疑问' } };
  });
  const parsed = await parseSopMaintenance((await buildSyntheticSopDraft(bytes, { ...input, rows })).workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.report.status).toBe('needs-review');
  expect(parsed.document.scenes[0]?.review.pendingText).toContain('原有合成疑问');
  expect(parsed.document.scenes[0]?.review.pendingText).toContain('来源');
  expect(parsed.document.scenes[0]?.review.pendingText).toContain(source.inventory.sourceSha256);
});

it('does not invent resource links or field provenance from row origin', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const input = choices(source);
  const rows = input.rows.map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 关联资源编号: '', 任务名称: '合成场景' } };
  });
  const draft = await buildSyntheticSopDraft(bytes, { ...input, rows });
  const parsed = await parseSopMaintenance(draft.workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(draft.report).toMatchObject({ mappingComplete: false, counts: { pending: 0, imagesNeedingReview: 3 } });
  expect(parsed.document.tasks.find(task => task.id === 'TASK-1')?.resourceIds).toEqual([]);
  expect(parsed.document.knowledge[0]?.resourceIds).toEqual([]);
  expect(parsed.document.resources).toHaveLength(2);
  expect(draft.report.ledger.find(item => item.sourceId === 'c:1:A2')?.segments[0]?.targets).toEqual(['scene.场景名称']);
  expect(draft.report.targets.find(item => item.key === 'task1')?.origin).toBe('source');
});

it('can reconcile a source with no pictures when all other decisions are complete', async () => {
  const bytes = await sourceWorkbook({ noImages: true }), source = await inspectSyntheticSopSource(bytes);
  const decisions = choicesWithoutImages(source), draft = await buildSyntheticSopDraft(bytes, decisions);
  expect(draft.report).toMatchObject({ mappingComplete: true, counts: { imagesNeedingReview: 0, pending: 0 } });
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('reviewed');
  const checked = await checkSyntheticSopSourceDraft({ source: bytes, decisions, workbook: draft.workbook });
  expect(checked).toMatchObject({ status: 'reviewed', sourceCheck: 'complete', workbookMatchesMapping: true,
    sourceSha256: digest(bytes), decisionsSha256: digest(Buffer.from(JSON.stringify(decisions))), workbookSha256: digest(draft.workbook),
    maintenance: { status: 'reviewed', sourceCheck: 'not-checked' }, reasons: [] });
  const changedRows = decisions.rows.map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'scene' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 适用范围: '另一合成范围' } };
  });
  const changed = await checkSyntheticSopSourceDraft({ source: bytes, decisions: { ...decisions, rows: changedRows }, workbook: draft.workbook });
  expect(changed).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', workbookMatchesMapping: false,
    reasons: ['WORKBOOK_CHANGED'] });
  expect(changed.decisionsSha256).not.toBe(checked.decisionsSha256);
  const edited = new ExcelJS.Workbook();
  await edited.xlsx.load(new Uint8Array(draft.workbook).buffer);
  const scene = edited.getWorksheet('场景目录');
  if (!scene) throw new Error('Synthetic scene missing');
  const headers = scene.getRow(2).values;
  if (!Array.isArray(headers)) throw new Error('Synthetic headers missing');
  scene.getRow(3).getCell(headers.indexOf('适用范围')).value = '另一合成范围';
  const editedBytes = Buffer.from(await edited.xlsx.writeBuffer());
  expect(await checkSyntheticSopSourceDraft({ source: bytes, decisions, workbook: editedBytes }))
    .toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', workbookMatchesMapping: false,
      workbookSha256: digest(editedBytes), maintenance: { status: 'reviewed', sourceCheck: 'not-checked' }, reasons: ['WORKBOOK_CHANGED'] });
  const repacked = await JSZip.loadAsync(draft.workbook);
  const repackedBytes = await repacked.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  expect(digest(repackedBytes)).not.toBe(digest(draft.workbook));
  expect(await checkSyntheticSopSourceDraft({ source: bytes, decisions, workbook: repackedBytes }))
    .toMatchObject({ status: 'reviewed', sourceCheck: 'complete', workbookMatchesMapping: true, workbookSha256: digest(repackedBytes) });
  await expect(checkSyntheticSopSourceDraft({ source: await sourceWorkbook({ noImages: true, extraSheet: true }),
    decisions, workbook: draft.workbook })).rejects.toThrow('SOURCE_IDENTITY_MISMATCH');
});

it('inventories every source sheet rather than selecting the first one', async () => {
  const source = await inspectSyntheticSopSource(await sourceWorkbook({ extraSheet: true }));
  expect(source.inventory.sheets.map(sheet => sheet.name)).toEqual(['合成原表', '合成另一表']);
  expect(source.inventory.objects).toContainEqual(expect.objectContaining({ id: 'c:2:B1', text: '合成另一表原文' }));
});

it('keeps 1095 synthetic text cells in the filterable preview without truncating records', async () => {
  const book = new ExcelJS.Workbook();
  book.creator = SYNTHETIC_SOURCE_CREATOR;
  const sheet = book.addWorksheet('合成大表');
  for (let index = 0; index < 1095; index++) {
    sheet.getCell(Math.floor(index / 15) + 1, index % 15 + 1).value = `合成内容 ${index + 1}`;
  }
  const source = await inspectSyntheticSopSource(Buffer.from(await book.xlsx.writeBuffer()));
  expect(source.inventory.objects).toHaveLength(1095);
  const preview = new ExcelJS.Workbook();
  await preview.xlsx.load(new Uint8Array(await createSyntheticSourcePreview(source)).buffer);
  const text = preview.getWorksheet('文字盘点预览');
  expect(text?.rowCount).toBe(1097);
  for (let index = 0; index < 1095; index++) {
    expect(text?.getCell(`C${index + 3}`).value).toBe(`合成内容 ${index + 1}`);
  }
  expect(text?.autoFilter).toBeTruthy();
  expect(preview.getWorksheet('图片盘点预览')?.autoFilter).toBeFalsy();
});

it('rejects missing references in the written workbook and never returns a partial maintenance document', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const draft = await buildSyntheticSopDraft(bytes, choices(source, { missingBranch: true }));
  expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false, maintenance: { status: 'invalid' } });
  expect(draft.report.maintenance.issues.map(issue => issue.code)).toContain('MISSING_REFERENCE');
  const parsed = await parseSopMaintenance(draft.workbook);
  expect(parsed.kind).toBe('invalid');
  expect(parsed).not.toHaveProperty('document');
});

it('refuses mismatched source identity, unconfirmed references, gaps and mapped objects without destinations', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const wrong = choices(source);
  await expect(buildSyntheticSopDraft(bytes, { ...wrong, sourceSha256: '0'.repeat(64) })).rejects.toThrow('SOURCE_IDENTITY_MISMATCH');
  const pending = choices(source);
  const modified = pending.decisions.map(item => item.sourceId === 'c:1:A2'
    ? { sourceId: item.sourceId, segments: [{ start: 0, end: 4, disposition: 'pending' }] } : item);
  await expect(buildSyntheticSopDraft(bytes, { ...pending, decisions: modified })).rejects.toThrow('UNCONFIRMED_SOURCE_REFERENCE');
  const gap = pending.decisions.map(item => item.sourceId === 'c:1:C2'
    ? { sourceId: item.sourceId, segments: [{ start: 0, end: 2, disposition: 'mapped' }, { start: 3, end: 5, disposition: 'pending' }] } : item);
  await expect(buildSyntheticSopDraft(bytes, { ...pending, decisions: gap })).rejects.toThrow('INVALID_SEGMENTS');
  const extra = { ...pending, rows: pending.rows.filter(row => typeof row === 'object' && row !== null && 'key' in row && row.key !== 'resource2') };
  await expect(buildSyntheticSopDraft(bytes, extra)).rejects.toThrow('MAPPED_WITHOUT_TARGET');
});

it('requires target provenance and permits one source segment to serve two explicit fields', async () => {
  const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
  const input = choices(source);
  const rows = input.rows.map(value => {
    if (typeof value !== 'object' || value === null || !('key' in value) || value.key !== 'task1' || !('fields' in value)
      || typeof value.fields !== 'object' || value.fields === null) return value;
    return { ...value, fields: { ...value.fields, 任务名称: sourceRef(source, 'c:1:B2') } };
  });
  const draft = await buildSyntheticSopDraft(bytes, { ...input, rows });
  expect(draft.report.ledger.find(item => item.sourceId === 'c:1:B2')?.segments[0]?.targets).toEqual(['task1.任务名称', 'task1.操作要求']);
  const invalid = rows.map(value => typeof value === 'object' && value !== null && 'key' in value && value.key === 'branch1'
    ? { ...value, origin: { kind: 'source' } } : value);
  await expect(buildSyntheticSopDraft(bytes, { ...input, rows: invalid })).rejects.toThrow('SOURCE_ORIGIN_WITHOUT_SOURCE');
});

it('marks formulas, cropped images and unknown parts as unsupported for review', async () => {
  const original = await sourceWorkbook({ formula: true }), zip = await JSZip.loadAsync(original);
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('Synthetic drawing missing');
  zip.file('xl/drawings/drawing1.xml', (await drawing.async('string')).replace('<a:stretch>', '<a:srcRect l="1000"/><a:stretch>'));
  zip.file('customXml/synthetic.xml', '<synthetic/>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const source = await inspectSyntheticSopSource(bytes);
  const unsupported = source.inventory.objects.filter(item => item.kind === 'unsupported');
  expect(unsupported).toEqual(expect.arrayContaining([
    expect.objectContaining({ location: 'E2', reason: expect.stringContaining('公式') }),
    expect.objectContaining({ location: 'xl/drawings/drawing1.xml#1', reason: expect.stringContaining('裁切') }),
    expect.objectContaining({ location: 'customXml/synthetic.xml' }),
  ]));
  const draft = await buildSyntheticSopDraft(bytes, { version: SOURCE_DECISIONS_VERSION, sourceSha256: source.inventory.sourceSha256, decisions: [], rows: [] });
  expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false, counts: { unsupported: 3 } });
  expect(draft.report.counts.pending).toBe(draft.report.counts.segments);
  expect((await parseSopMaintenance(draft.workbook)).report.status).toBe('invalid');
});

it('requires an explicit synthetic source marker', async () => {
  await expect(inspectSyntheticSopSource(await sourceWorkbook({ marker: false }))).rejects.toThrow('SYNTHETIC_MARKER_REQUIRED');
});

it('runs the offline CLI through saved inventory, decisions and a reopened workbook', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sop-source-cli-'));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const sourcePath = join(directory, 'source.xlsx'), scanPath = join(directory, 'inventory');
    const bytes = await sourceWorkbook();
    await writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 });
    expect(await runSyntheticSourceCli(['inventory', sourcePath, scanPath])).toBe(0);
    const inventory: unknown = JSON.parse(await readFile(join(scanPath, 'inventory.json'), 'utf8'));
    expect(inventory).toMatchObject({ sourceSha256: digest(bytes), publishable: false });
    const preview = new ExcelJS.Workbook();
    await preview.xlsx.load(new Uint8Array(await readFile(join(scanPath, 'inventory-preview.xlsx'))).buffer);
    const previewSheet = preview.getWorksheet('文字盘点预览'), previewImages = preview.getWorksheet('图片盘点预览');
    expect(previewSheet?.getRow(1).getCell(3).value).toContain('编辑不会回写决策');
    expect(previewSheet?.rowCount).toBe(7);
    expect(previewSheet?.getImages()).toHaveLength(0);
    expect(previewImages?.getRow(1).getCell(3).value).toContain('请勿排序或筛选');
    expect(previewImages?.getImages()).toHaveLength(3);
    expect(previewImages?.autoFilter).toBeFalsy();
    expect(previewImages?.getImages().map(image => previewImages.getRow(image.range.tl.nativeRow + 1).getCell(5).value))
      .toEqual(['b:1:1', 'p:1:1:1', 'p:1:1:2']);
    expect(previewSheet?.getRows(3, 5)?.find(row => row.getCell(6).value === 'c:1:B2')?.getCell(3).value).toBe('合成第一行\n  保留空格');
    const source = await inspectSyntheticSopSource(bytes);
    const mappedPath = join(directory, 'mapped.json');
    await writeFile(mappedPath, JSON.stringify(choices(source)), { flag: 'wx', mode: 0o600 });
    const mappedDraftPath = join(directory, 'mapped-draft');
    expect(await runSyntheticSourceCli(['draft', sourcePath, mappedPath, mappedDraftPath])).toBe(3);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'needs-review',
      maintenanceStatus: 'needs-review', mappingComplete: false, counts: { pending: 0, imagesNeedingReview: 3 } });
    expect((await parseSopMaintenance(await readFile(join(mappedDraftPath, 'maintenance.xlsx')))).report.status).toBe('needs-review');
    const pendingPath = join(directory, 'pending.json');
    await writeFile(pendingPath, JSON.stringify(choices(source, { pendingSecondImage: true })), { flag: 'wx', mode: 0o600 });
    const draftPath = join(directory, 'draft');
    expect(await runSyntheticSourceCli(['draft', sourcePath, pendingPath, draftPath])).toBe(3);
    const result: unknown = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(result).toMatchObject({ status: 'needs-review', maintenanceStatus: 'needs-review', publishable: false, mappingComplete: false });
    const saved = await readFile(join(draftPath, 'maintenance.xlsx'));
    const parsed = await parseSopMaintenance(saved);
    expect(parsed.report).toMatchObject({ status: 'needs-review', publishable: false, images: 1 });
    const report: unknown = JSON.parse(await readFile(join(draftPath, 'reconciliation.json'), 'utf8'));
    expect(report).toMatchObject({ sourceSha256: digest(bytes), workbookSha256: digest(saved), publishable: false, counts: { pending: 1 } });
    const duplicate = join(directory, 'duplicate.json');
    await writeFile(duplicate, '{"version":"one","version":"two"}', { flag: 'wx', mode: 0o600 });
    await expect(runSyntheticSourceCli(['draft', sourcePath, duplicate, join(directory, 'rejected')])).rejects.toThrow('NONCANONICAL_DECISIONS_JSON');
  } finally {
    output.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

it('runs the source-aware maintenance CLI against the saved source, decisions and current workbook', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sop-source-check-'));
  const cli = new URL('../../../scripts/check-sop-maintenance.mjs', import.meta.url);
  const run = (args: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [cli.pathname, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout, stderr });
    });
  });
  try {
    const bytes = await sourceWorkbook(), source = await inspectSyntheticSopSource(bytes);
    const decisions = choices(source), draft = await buildSyntheticSopDraft(bytes, decisions);
    const sourcePath = join(directory, 'source.xlsx'), decisionsPath = join(directory, 'decisions.json');
    const workbookPath = join(directory, 'maintenance.xlsx'), reportPath = join(directory, 'report.json');
    await writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(decisionsPath, JSON.stringify(decisions), { flag: 'wx', mode: 0o600 });
    await writeFile(workbookPath, draft.workbook, { flag: 'wx', mode: 0o600 });
    const check = await run(['--source', sourcePath, decisionsPath, workbookPath, reportPath]);
    expect(check.code).toBe(3);
    expect(JSON.parse(check.stdout)).toMatchObject({ mode: 'synthetic-source', status: 'needs-review', sourceCheck: 'needs-review',
      workbookMatchesMapping: true, reasons: expect.arrayContaining(['IMAGE_REVIEW_REQUIRED']) });
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({ sourceSha256: digest(bytes),
      decisionsSha256: digest(Buffer.from(JSON.stringify(decisions))), workbookSha256: digest(draft.workbook), publishable: false });

    const edited = new ExcelJS.Workbook();
    await edited.xlsx.load(new Uint8Array(draft.workbook).buffer);
    const scene = edited.getWorksheet('场景目录');
    if (!scene) throw new Error('Synthetic scene missing');
    const headers = scene.getRow(2).values;
    if (!Array.isArray(headers)) throw new Error('Synthetic headers missing');
    scene.getRow(3).getCell(headers.indexOf('待确认事项')).value = null;
    const editedBytes = Buffer.from(await edited.xlsx.writeBuffer()), editedPath = join(directory, 'edited.xlsx');
    await writeFile(editedPath, editedBytes, { flag: 'wx', mode: 0o600 });
    const editedReportPath = join(directory, 'edited-report.json');
    const checkedEdit = await run(['--source', sourcePath, decisionsPath, editedPath, editedReportPath]);
    expect(checkedEdit.code).toBe(3);
    expect(JSON.parse(checkedEdit.stdout)).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review',
      workbookMatchesMapping: false, reasons: expect.arrayContaining(['WORKBOOK_CHANGED', 'IMAGE_REVIEW_REQUIRED']) });
    expect(JSON.parse(await readFile(editedReportPath, 'utf8'))).toMatchObject({ workbookSha256: digest(editedBytes),
      maintenance: { status: 'reviewed', sourceCheck: 'not-checked' } });

    const wrongPath = join(directory, 'wrong-decisions.json'), missingReport = join(directory, 'missing.json');
    await writeFile(wrongPath, JSON.stringify({ ...decisions, sourceSha256: '0'.repeat(64) }), { flag: 'wx', mode: 0o600 });
    const wrong = await run(['--source', sourcePath, wrongPath, workbookPath, missingReport]);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('SOURCE_IDENTITY_MISMATCH');
    await expect(readFile(missingReport)).rejects.toThrow();

    const textBytes = await sourceWorkbook({ noImages: true }), textSource = await inspectSyntheticSopSource(textBytes);
    const textDecisions = choicesWithoutImages(textSource), textDraft = await buildSyntheticSopDraft(textBytes, textDecisions);
    const textSourcePath = join(directory, 'text-source.xlsx'), textDecisionsPath = join(directory, 'text-decisions.json');
    const textWorkbookPath = join(directory, 'text-maintenance.xlsx'), textReportPath = join(directory, 'text-report.json');
    await writeFile(textSourcePath, textBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(textDecisionsPath, JSON.stringify(textDecisions), { flag: 'wx', mode: 0o600 });
    await writeFile(textWorkbookPath, textDraft.workbook, { flag: 'wx', mode: 0o600 });
    const textCheck = await run(['--source', textSourcePath, textDecisionsPath, textWorkbookPath, textReportPath]);
    expect(textCheck.code).toBe(0);
    expect(JSON.parse(textCheck.stdout)).toMatchObject({ mode: 'synthetic-source', status: 'reviewed', sourceCheck: 'complete',
      workbookMatchesMapping: true, publishable: false, reasons: [] });
    expect(JSON.parse(await readFile(textReportPath, 'utf8'))).toMatchObject({ sourceSha256: digest(textBytes),
      workbookSha256: digest(textDraft.workbook), sourceCheck: 'complete', publishable: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it('retains source GIF bytes and positions while blocking a mapped or excluded GIF from completion', async () => {
  const bytes = await sourceWorkbook({ imageBytes: gif, imageExtension: 'gif' });
  const source = await inspectSyntheticSopSource(bytes);
  const images = source.inventory.objects.filter(item => item.kind === 'image' || item.kind === 'background');
  expect(images).toHaveLength(3);
  for (const image of images) {
    expect(image).toMatchObject({ extension: 'gif', reviewWarnings: expect.arrayContaining([expect.stringContaining('GIF')]) });
    expect(source.images.get(image.id)).toEqual(gif);
  }
  const preview = new ExcelJS.Workbook();
  await preview.xlsx.load(new Uint8Array(await createSyntheticSourcePreview(source)).buffer);
  expect(preview.getWorksheet('图片盘点预览')?.getCell('G3').value).toContain('GIF');

  const proposed = choices(source);
  const draft = await buildSyntheticSopDraft(bytes, proposed);
  expect(draft.report).toMatchObject({ publishable: false, mappingComplete: false, counts: { unsupported: 3 }, maintenance: { status: 'invalid' } });
  expect(draft.report.maintenance.issues).toContainEqual(expect.objectContaining({ code: 'MEDIA_FORMAT_UNSUPPORTED', sheet: '资源与图片', row: 3, fix: expect.stringContaining('GIF') }));
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(new Uint8Array(draft.workbook).buffer);
  const placed = saved.getWorksheet('资源与图片')?.getImages() ?? [];
  expect(placed).toHaveLength(2);
  expect(Buffer.from(saved.getImage(Number(placed[0]?.imageId)).buffer!)).toEqual(gif);
  const check = await checkSyntheticSopSourceDraft({ source: bytes, decisions: proposed, workbook: draft.workbook });
  expect(check).toMatchObject({ publishable: false, sourceCheck: 'needs-review' });
  expect(check.reasons).toContain('UNSUPPORTED_SOURCE_OBJECTS');

  const withoutImages = choicesWithoutImages(source);
  const excluded = { ...withoutImages, decisions: withoutImages.decisions.map(item =>
    item.sourceId.startsWith('p:') ? { ...item, disposition: 'excluded', reason: '合成排除记录' } : item) };
  const excludedDraft = await buildSyntheticSopDraft(bytes, excluded);
  expect(excludedDraft.report).toMatchObject({ publishable: false, mappingComplete: false, counts: { unsupported: 3 } });
  expect(excludedDraft.report.ledger.filter(item => item.kind === 'image')).toHaveLength(2);
  const excludedCheck = await checkSyntheticSopSourceDraft({ source: bytes, decisions: excluded, workbook: excludedDraft.workbook });
  expect(excludedCheck.sourceCheck).toBe('needs-review');
  expect(excludedCheck.reasons).toContain('UNSUPPORTED_SOURCE_OBJECTS');
});

it('retains JPEG bytes through synthetic inventory and the maintenance draft', async () => {
  const bytes = await sourceWorkbook({ imageBytes: jpeg, imageExtension: 'jpeg' });
  const source = await inspectSyntheticSopSource(bytes);
  const image = source.inventory.objects.find(item => item.kind === 'image');
  expect(image).toMatchObject({ extension: 'jpeg' });
  if (!image || image.kind !== 'image') throw new Error('SYNTHETIC_IMAGE_MISSING');
  expect(source.images.get(image.id)).toEqual(jpeg);
  const draft = await buildSyntheticSopDraft(bytes, choices(source));
  const parsed = await parseSopMaintenance(draft.workbook);
  expect(parsed.kind).toBe('parsed');
  if (parsed.kind !== 'parsed') throw new Error('SYNTHETIC_DRAFT_INVALID');
  expect(parsed.document.resources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'image', images: [expect.objectContaining({ mime: 'image/jpeg', bytes: jpeg })] })]));
});

it('records an unreferenced GIF as an unsupported source resource', async () => {
  const zip = await JSZip.loadAsync(await sourceWorkbook({ noImages: true }));
  zip.file('xl/media/unreferenced.gif', gif);
  const file = zip.file('[Content_Types].xml');
  if (!file) throw new Error('SYNTHETIC_CONTENT_TYPES_MISSING');
  zip.file('[Content_Types].xml', (await file.async('string')).replace('</Types>', '<Default Extension="gif" ContentType="image/gif"/></Types>'));
  const source = await inspectSyntheticSopSource(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(source.inventory.objects).toContainEqual(expect.objectContaining({ kind: 'unsupported', location: 'xl/media/unreferenced.gif', reason: expect.stringContaining('GIF') }));
});
