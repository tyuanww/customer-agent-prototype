import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseXlsxFirstSheet } from '../../src/main/xlsx-first-sheet';
import { parseCoachUploadTable } from '../../src/shared/coach-content-upload';

const FAQ_DIR = '/Users/hutou/Desktop/customer-agent- FAQ';

function zipLocal(name: string, payload: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(payload);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(payload.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, compressed]);
}

function workbook(): Buffer {
  const shared = Buffer.from(
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>快捷短语</t></si><si><t>产品话术</t></si><si><t>面膜紫适用人群</t></si><si><t>亲亲这是话术</t></si></sst>',
  );
  const sheet = Buffer.from(
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'
    + '</sheetData></worksheet>',
  );
  const workbookXml = Buffer.from(
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="产品话术" r:id="rId1"/></sheets></workbook>',
  );
  const rels = Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  return Buffer.concat([
    zipLocal('xl/sharedStrings.xml', shared),
    zipLocal('xl/worksheets/sheet1.xml', sheet),
    zipLocal('xl/workbook.xml', workbookXml),
    zipLocal('xl/_rels/workbook.xml.rels', rels),
  ]);
}

describe('xlsx first sheet', () => {
  it('reads the first worksheet and maps 快捷短语/产品话术', () => {
    const table = parseXlsxFirstSheet(workbook());
    expect(table[0]).toEqual(['快捷短语', '产品话术']);
    expect(table[1]).toEqual(['面膜紫适用人群', '亲亲这是话术']);
    const parsed = parseCoachUploadTable(table, '【FAQ】MENOKIN话术.xlsx');
    expect(parsed).toMatchObject({
      ok: true,
      rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' }],
    });
  });

  it('parses the live MENOKIN FAQ xlsx with 快捷短语 headers', function liveFaqXlsx() {
    const path = `${FAQ_DIR}/minokin话术库/【FAQ】MENOKIN话术.xlsx`;
    if (!existsSync(path)) return;
    const table = parseXlsxFirstSheet(readFileSync(path));
    expect(table[0]?.slice(0, 3)).toEqual(['', '快捷短语', '产品话术']);
    const parsed = parseCoachUploadTable(table, '【FAQ】MENOKIN话术.xlsx');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(106);
    expect(parsed.rows[0]).toMatchObject({
      scene: '30秒泡泡面膜 · 面膜紫适用人群',
      domain: 'product',
    });
  });

  it('parses live 售前/售后/活动/QA workbooks with filename domains', function liveFolderXlsx() {
    const files = [
      [`${FAQ_DIR}/minokin话术库/【售前】MENOKIN话术.xlsx`, '【售前】MENOKIN话术.xlsx', 'presale', 75],
      [`${FAQ_DIR}/minokin话术库/【售后】MENOKIN话术.xlsx`, '【售后】MENOKIN话术.xlsx', 'aftersale', 222],
      [`${FAQ_DIR}/minokin话术库/【活动】MENOKIN话术.xlsx`, '【活动】MENOKIN话术.xlsx', 'campaign', 4],
      [`${FAQ_DIR}/minokin产品话术库/【FAQ】menokin产品QA&话术.xlsx`, '【FAQ】menokin产品QA&话术.xlsx', 'product', 111],
    ] as const;
    if (files.some((item) => !existsSync(item[0]))) return;
    for (const [path, sourceName, domain, rows] of files) {
      const parsed = parseCoachUploadTable(parseXlsxFirstSheet(readFileSync(path)), sourceName);
      expect(parsed.ok, sourceName).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.rows, sourceName).toHaveLength(rows);
      expect(parsed.rows.every((row) => row.domain === domain), sourceName).toBe(true);
    }
  });
});
