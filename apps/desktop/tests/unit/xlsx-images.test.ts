// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dashboardContentParseUpload } from '../../src/main/dashboard-content';
import { DeskKnowledgeStore } from '../../src/shared/desk-knowledge';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a', 'latin1');

function zipLocal(name: string, payload: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const body = deflateRawSync(payload);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(payload.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, body]);
}

const rels = (items: readonly (readonly [string, string])[]) => Buffer.from(
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    items.map(([id, target]) => `<Relationship Id="${id}" Type="t" Target="${target}"/>`).join('')}</Relationships>`,
);

const anchor = (row0: number, embed: string) =>
  `<xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${String(row0)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
  + `<xdr:to><xdr:col>3</xdr:col><xdr:row>${String(row0 + 1)}</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="${embed}"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;

type Options = {
  rows?: readonly (readonly [string, string])[];
  anchors?: readonly string[];
  media?: Readonly<Record<string, Buffer>>;
  sheetExtra?: string;
  sheets?: number;
};

function workbook({ rows = [], anchors = [], media = {}, sheetExtra = '', sheets = 1 }: Options): Buffer {
  const strings = ['快捷短语', '产品话术', ...rows.flat()];
  const shared = Buffer.from(`<?xml version="1.0"?><sst>${strings.map((value) => `<si><t xml:space="preserve">${value}</t></si>`).join('')}</sst>`);
  const body = rows.map((row, index) => {
    const r = index + 2;
    const cell = (col: string, text: string) => text === '' ? '' : `<c r="${col}${String(r)}" t="s"><v>${String(strings.indexOf(text))}</v></c>`;
    return `<row r="${String(r)}">${cell('A', row[0])}${cell('B', row[1])}</row>`;
  }).join('');
  const sheet = Buffer.from('<?xml version="1.0"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + `${body}</sheetData>${anchors.length ? '<drawing r:id="rId1"/>' : ''}${sheetExtra}</worksheet>`);
  const workbookXml = Buffer.from(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    Array.from({ length: sheets }, (_, index) => `<sheet name="s${String(index)}" r:id="rId${String(index + 1)}"/>`).join('')}</sheets></workbook>`);
  const drawing = Buffer.from(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r">${anchors.join('')}</xdr:wsDr>`);
  const mediaNames = Object.keys(media);
  return Buffer.concat([
    zipLocal('xl/sharedStrings.xml', shared),
    zipLocal('xl/worksheets/sheet1.xml', sheet),
    zipLocal('xl/workbook.xml', workbookXml),
    zipLocal('xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheets/sheet1.xml']])),
    ...(anchors.length ? [
      zipLocal('xl/worksheets/_rels/sheet1.xml.rels', rels([['rId1', '../drawings/drawing1.xml'], ['rId2', '../media/bg.png']])),
      zipLocal('xl/drawings/drawing1.xml', drawing),
      zipLocal('xl/drawings/_rels/drawing1.xml.rels', rels(mediaNames.map((name, index) => [`rId${String(index + 1)}`, `../media/${name}`]))),
    ] : []),
    ...mediaNames.map((name) => zipLocal(`xl/media/${name}`, media[name]!)),
  ]);
}

const parse = (bytes: Buffer, sourceName = '【售前】合成话术.xlsx') => dashboardContentParseUpload({ sourceName, bytes });

const rows = [
  ['合成问题一', '第一行\n第二行'],
  ['合成问题二', '没有图片'],
  ['合成问题三', '带第二张图'],
] as const;

describe('xlsx images follow their wording row', () => {
  it('maps each anchored picture to the row its top-left corner sits in and keeps line breaks', () => {
    const result = parse(workbook({ rows, anchors: [anchor(1, 'rId1'), anchor(3, 'rId2')], media: { 'a.png': PNG, 'b.jpeg': JPEG } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.script)).toEqual(['第一行\n第二行', '没有图片', '带第二张图']);
    expect(result.rows.every((row) => row.domain === 'presale')).toBe(true);
    expect(result.images).toEqual([
      { index: 0, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` },
      { index: 2, dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}` },
    ]);
    expect(result.notices).toEqual([]);
  });

  it('reports background, extra sheets, comments, hyperlinks and shapes instead of dropping them silently', () => {
    const shape = '<xdr:twoCellAnchor><xdr:from><xdr:row>1</xdr:row></xdr:from><xdr:sp/></xdr:twoCellAnchor>';
    const result = parse(workbook({
      rows, anchors: [anchor(1, 'rId1'), shape], media: { 'a.png': PNG }, sheets: 2,
      sheetExtra: '<legacyDrawing r:id="rId3"/><picture r:id="rId2"/><hyperlinks><hyperlink ref="B2" r:id="rId4"/></hyperlinks>',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(result.notices).toEqual([
      '工作簿有 2 张工作表，只导入第一张。',
      '工作表背景图不属于任何话术，未导入。',
      '单元格批注未导入。',
      '1 个超链接只保留显示文字，链接地址未导入。',
      '有 1 个图形、图表或链接图片无法对应到话术行，未导入。',
    ]);
  });

  it('refuses the file when a picture sits on a row that will not be imported', () => {
    const skipped = [['合成问题一', '含 {未知} 占位'], ['合成问题二', '正常']] as const;
    expect(parse(workbook({ rows: skipped, anchors: [anchor(1, 'rId1')], media: { 'a.png': PNG } }))).toEqual({
      ok: false, code: 'invalid-table', message: '第 2 行有图片，但这一行不会导入。请补全或修改这一行后重试。',
    });
    expect(parse(workbook({ rows, anchors: [anchor(0, 'rId1')], media: { 'a.png': PNG } }))).toMatchObject({
      ok: false, message: '第 1 行有图片，但这一行不会导入。请补全或修改这一行后重试。',
    });
  });

  it('names skipped rows and the allowed placeholders', () => {
    const result = parse(workbook({ rows: [['合成问题一', '正常'], ['合成问题二', '请 {转接} 处理'], ['', '缺问题']] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.sourceName).toBe('【售前】合成话术.xlsx · 已跳过空白或不完整 1 行（第 4 行）。已跳过含 { } 的 1 行（第 3 行），只允许 {订单号}、{日期}。');
  });

  it('gives a specific message for unsupported or broken pictures', () => {
    expect(parse(workbook({ rows, anchors: [anchor(1, 'rId1')], media: { 'a.gif': GIF } }))).toMatchObject({
      ok: false, code: 'binary-workbook', message: 'Excel 里有图片不是 PNG 或 JPEG，请另存为这两种格式后重试。',
    });
    expect(parse(workbook({ rows, anchors: [anchor(1, 'rId9')], media: { 'a.png': PNG } }))).toMatchObject({
      ok: false, message: 'Excel 里有图片文件缺失，请在 Excel 中重新插入图片后重试。',
    });
  });

  it('saves pictures with their wording and reads them back after a restart', () => {
    const parsed = parse(workbook({ rows, anchors: [anchor(1, 'rId1'), anchor(3, 'rId2')], media: { 'a.png': PNG, 'b.jpeg': JPEG } }));
    if (!parsed.ok) throw new Error('fixture must parse');
    let disk: string | null = null;
    const clock = { now: () => '2026-10-29T00:00:00.000Z', load: () => disk, save: (raw: string) => { disk = raw; } };
    const store = new DeskKnowledgeStore(clock);
    const reply = store.command('operator', {
      action: 'import-csv', personaId: 'shop', fileName: '【售前】合成话术.xlsx', csvText: parsed.csvText, category: 'product', images: parsed.images,
    }, '合成运营');
    expect(reply.ok).toBe(true);
    const reopenedStore = new DeskKnowledgeStore(clock);
    const reopened = reopenedStore.command('operator', { action: 'select-persona', personaId: 'presale' }, '合成运营');
    if (!reopened.ok) throw new Error('reload must succeed');
    expect(reopened.view.persistence).toBe('ok');
    const items = reopened.view.items;
    const byName = new Map(items.map((item) => [item.name, item]));
    expect(byName.get('合成问题一')?.body).toBe('第一行\n第二行');
    expect(byName.get('合成问题一')?.images).toEqual([`data:image/png;base64,${PNG.toString('base64')}`]);
    expect(byName.get('合成问题二')?.images).toBeUndefined();
    expect(byName.get('合成问题三')?.images).toEqual([`data:image/jpeg;base64,${JPEG.toString('base64')}`]);
  });

  it('rejects renderer-supplied images that are not PNG/JPEG data or point past the rows', () => {
    const store = new DeskKnowledgeStore({ now: () => 'x', load: () => null, save: () => undefined });
    const base = { action: 'import-csv', personaId: 'shop', fileName: 'a.csv', csvText: 'scene,script\n合成问题,答案\n', category: 'product' } as const;
    expect(store.command('operator', { ...base, images: [{ index: 0, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] }, null)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(store.command('operator', { ...base, images: [{ index: 1, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }] }, null))
      .toMatchObject({ ok: false, message: '图片所在话术无法导入，请检查该行后重试。' });
  });
});

describe('self-closing empty cells', () => {
  it('do not swallow the next row', () => {
    const shared = Buffer.from('<?xml version="1.0"?><sst><si><t>快捷短语</t></si><si><t>产品话术</t></si><si><t>合成问题甲</t></si><si><t>答案甲</t></si><si><t>合成问题乙</t></si><si><t>答案乙</t></si></sst>');
    const sheet = Buffer.from('<?xml version="1.0"?><worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" s="5"/></row>'
      + '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="s"><v>3</v></c><c r="F3" s="4"/><c r="G3" s="4"/></row>'
      + '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c></row>'
      + '</sheetData></worksheet>');
    const bytes = Buffer.concat([
      zipLocal('xl/sharedStrings.xml', shared),
      zipLocal('xl/worksheets/sheet1.xml', sheet),
      zipLocal('xl/workbook.xml', Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="s" r:id="rId1"/></sheets></workbook>')),
      zipLocal('xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheets/sheet1.xml']])),
    ]);
    const result = parse(bytes);
    expect(result).toMatchObject({ ok: true, sourceName: '【售前】合成话术.xlsx', rows: [
      { scene: '合成问题甲', script: '答案甲' }, { scene: '合成问题乙', script: '答案乙' },
    ] });
  });
});
