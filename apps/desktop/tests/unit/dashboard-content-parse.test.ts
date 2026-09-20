// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dashboardContentParseUpload } from '../../src/main/dashboard-content';
import { CONTENT_IMPORT_MAX_BYTES } from '../../src/shared/dashboard-content';

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
    '<?xml version="1.0"?><sst><si><t>快捷短语</t></si><si><t>产品话术</t></si><si><t>面膜紫适用人群</t></si><si><t>亲亲这是话术</t></si></sst>',
  );
  const sheet = Buffer.from(
    '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'
    + '</sheetData></worksheet>',
  );
  const workbookXml = Buffer.from(
    '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="产品话术" r:id="rId1"/></sheets></workbook>',
  );
  const rels = Buffer.from(
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  return Buffer.concat([
    zipLocal('xl/sharedStrings.xml', shared),
    zipLocal('xl/worksheets/sheet1.xml', sheet),
    zipLocal('xl/workbook.xml', workbookXml),
    zipLocal('xl/_rels/workbook.xml.rels', rels),
  ]);
}

describe('dashboardContentParseUpload', () => {
  it('fail-closes invalid payloads, oversize files, and unreadable workbooks', () => {
    expect(dashboardContentParseUpload(null)).toMatchObject({ ok: false, code: 'invalid-table' });
    expect(dashboardContentParseUpload([])).toMatchObject({ ok: false, code: 'invalid-table' });
    expect(dashboardContentParseUpload({ sourceName: 'faq.xlsx' })).toMatchObject({
      ok: false,
      code: 'invalid-table',
    });
    expect(dashboardContentParseUpload({ bytes: workbook() })).toMatchObject({
      ok: false,
      code: 'invalid-table',
    });
    expect(dashboardContentParseUpload({
      sourceName: 'faq.xlsx',
      bytes: Buffer.alloc(CONTENT_IMPORT_MAX_BYTES + 1),
    })).toMatchObject({
      ok: false,
      code: 'too-large',
      message: '文件超过 10MiB。',
    });
    expect(dashboardContentParseUpload({
      sourceName: 'faq.xlsx',
      bytes: Buffer.from('not-xlsx'),
    })).toMatchObject({
      ok: false,
      code: 'binary-workbook',
      message: 'Excel 未能解析。未连接飞书或 Wiki。',
    });
  });

  it('accepts ArrayBuffer, Uint8Array, and number[] bytes and maps the first sheet', () => {
    const bytes = workbook();
    const expected = {
      ok: true,
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' }],
    };
    expect(dashboardContentParseUpload({
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      bytes: new Uint8Array(bytes),
    })).toMatchObject(expected);
    expect(dashboardContentParseUpload({
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      bytes: Uint8Array.from(bytes).buffer,
    })).toMatchObject(expected);
    expect(dashboardContentParseUpload({
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      bytes: Array.from(bytes),
    })).toMatchObject(expected);
    expect(dashboardContentParseUpload({
      sourceName: '   ',
      bytes: new Uint8Array(bytes),
    })).toMatchObject({
      ok: true,
      sourceName: 'upload.xlsx',
      rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术' }],
    });
  });
});
