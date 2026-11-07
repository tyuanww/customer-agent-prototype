import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  MENOKIN_FLAT_SOP_WORKBOOK_HEADERS,
  MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME,
  MENOKIN_SOP_SEVERITY_ORDER,
  parseMenokinFlatSopWorkbook,
  projectMenokinSopSourceRows,
  validateMenokinSourceRows,
  type MenokinFlatSopWorkbookParseResult,
} from '@customer-agent/content-intake';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=';
const ONE_PIXEL_PNG_BYTES = Buffer.from(ONE_PIXEL_PNG, 'base64');
type Header = (typeof MENOKIN_FLAT_SOP_WORKBOOK_HEADERS)[number];

const syntheticValues: Readonly<Record<Header, string>> = {
  地区: '合成地区',
  商业类型: '合成商业类型',
  店铺: '合成店铺',
  作用: '核对合成作用',
  SOP归属: '少错破SOP',
  步骤说明: '按合成条件核对',
  步骤类型: '合成流程',
  路径选择: '',
  步骤: 'D1',
  字段: '合成字段值',
  操作说明: '完成合成操作',
  话术: '合成对客说明',
  快捷语: '合成快捷语',
  前提条件: '合成前提',
  判断维度: '合成判断维度',
  类型判断: '合成类型判断',
  症状描述: '合成症状描述',
  图片: '',
};

const syntheticRow = (overrides: Partial<Record<Header, string>> = {}): string[] =>
  MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.map((header) => overrides[header] ?? syntheticValues[header]);

type WorkbookFixture = Readonly<{
  headers?: readonly string[];
  rows?: readonly (readonly string[])[];
  imageRows?: readonly number[];
  extraSheet?: boolean;
  mutate?: (book: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) => void;
}>;

async function workbookBytes(fixture: WorkbookFixture = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.created = new Date('2026-11-06T00:00:00.000Z');
  book.modified = book.created;
  const sheet = book.addWorksheet(MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME);
  sheet.addRow([...(fixture.headers ?? MENOKIN_FLAT_SOP_WORKBOOK_HEADERS)]);
  for (const values of fixture.rows ?? []) sheet.addRow([...values]);

  const imageRows = fixture.imageRows ?? [];
  if (imageRows.length > 0) {
    const imageId = book.addImage({ base64: ONE_PIXEL_PNG, extension: 'png' });
    for (const row of imageRows) {
      sheet.addImage(imageId, {
        tl: { col: MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.length - 1, row: row - 1 },
        ext: { width: 8, height: 8 },
      });
    }
  }
  if (fixture.extraSheet) book.addWorksheet('合成额外页').getCell('A1').value = '合成额外页文字';
  fixture.mutate?.(book, sheet);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function withWpsCellImage(
  bytes: Buffer,
  imageName: string,
  imageBytes: Buffer,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookRelationships = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  zip.file('xl/_rels/workbook.xml.rels', workbookRelationships.replace(
    '</Relationships>',
    '<Relationship Id="rIdWpsCellImage" Type="http://schemas.microsoft.com/office/2017/06/relationships/cellImage" Target="cellimages.xml"/></Relationships>',
  ));
  const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', contentTypes.replace(
    '</Types>',
    '<Override PartName="/xl/cellimages.xml" ContentType="application/vnd.wps-officedocument.cellimage+xml"/></Types>',
  ));
  zip.file('xl/cellimages.xml', `<?xml version="1.0" encoding="UTF-8"?><etc:cellImages xmlns:etc="http://schemas.microsoft.com/office/spreadsheetml/2017/06/main" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="${imageName}"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>`);
  zip.file('xl/_rels/cellimages.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/wps-image.png"/></Relationships>');
  zip.file('xl/media/wps-image.png', imageBytes);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function expectProjects(result: MenokinFlatSopWorkbookParseResult): void {
  expect(result.ok).toBe(true);
  expect(validateMenokinSourceRows(result.sourceRows)).toEqual([]);
  expect(projectMenokinSopSourceRows(result.sourceRows).inputIssues).toEqual([]);
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('Menokin flat SOP workbook source parser', () => {
  it('reads all five approved SOP groups and produces directly projectable rows', async () => {
    const steps = ['D1', 'D7', 'DS', 'E1', 'E2'] as const;
    const rows = MENOKIN_SOP_SEVERITY_ORDER.map((group, index) => syntheticRow({
      SOP归属: group,
      步骤: steps[index]!,
    }));
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({ rows }));

    expectProjects(result);
    expect(result.sourceRows.map((row) => row.sopGroup)).toEqual(MENOKIN_SOP_SEVERITY_ORDER);
    expect(result.sourceRows.map((row) => row.sheetName)).toEqual(MENOKIN_SOP_SEVERITY_ORDER);
    expect(result.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.sourceRows.every((row) => row.sourceEntryCode
      === `FLAT-${result.sourceSha256.slice(0, 24)}-R${row.rowNumber}`)).toBe(true);
    expect(result.sourceRows.every((row) => row.rowHash)).toBe(true);
  });

  it('maps D1, D7 and DS to execution step 3 and E1/E2 to terminals', async () => {
    const steps = ['D1', 'D7', 'DS', 'E1', 'E2'] as const;
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: steps.map((step) => syntheticRow({ 步骤: step })),
    }));

    expectProjects(result);
    expect(result.sourceRows.map((row) => {
      const node = row.nodes[0]!;
      return [node.nodeKey, node.nodeType, node.stepNumber];
    })).toEqual([
      ['D1', 'execution', 3],
      ['D7', 'execution', 3],
      ['DS', 'execution', 3],
      ['E1', 'terminal', null],
      ['E2', 'terminal', null],
    ]);
    expect(result.sourceRows[0]?.nodes[0]).toMatchObject({
      title: '核对合成作用',
      body: '按合成条件核对\n完成合成操作',
    });
    expect(result.sourceRows[0]?.fields).toEqual([{
      key: 'field',
      value: '合成字段值',
      targetNodeKey: 'D1',
    }]);
    expect(result.sourceRows[0]?.knowledge.map((entry) => entry.key)).toEqual([
      'region',
      'businessType',
      'shop',
      'purpose',
      'stepExplanation',
      'stepType',
      'operationInstructions',
      'precondition',
      'judgmentDimension',
      'typeJudgment',
      'symptomDescription',
    ]);
  });

  it('keeps numeric-looking, A/B/C and missing steps unresolved without inventing semantics', async () => {
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: ['', 'A', 'B', 'C', ''].map((step, index) => syntheticRow({
        步骤: step,
        字段: index === 4 ? '' : syntheticValues.字段,
      })),
      mutate: (_book, sheet) => { sheet.getCell('I2').value = 1; },
    }));

    expectProjects(result);
    expect(result.sourceRows.map((row) => {
      const node = row.nodes[0]!;
      return [node.nodeKey, node.nodeType, node.stepNumber];
    })).toEqual([
      ['1', 'unresolved', null],
      ['A', 'unresolved', null],
      ['B', 'unresolved', null],
      ['C', 'unresolved', null],
      [null, 'unresolved', null],
    ]);
    expect(result.sourceRows[4]?.fields).toEqual([]);
  });

  it('reads rich text and hyperlink display text while discarding link targets', async () => {
    const hyperlink = 'https://synthetic.example/display-only';
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow()],
      mutate: (_book, sheet) => {
        sheet.getCell('J2').value = {
          richText: [{ text: '合成富文本' }, { text: '字段' }],
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('K2').value = {
          richText: [{ text: '合成富文本' }, { text: '操作' }],
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('L2').value = {
          text: '合成链接显示文本',
          hyperlink,
        } as unknown as ExcelJS.CellValue;
      },
    }));

    expectProjects(result);
    expect(result.sourceRows[0]?.fields).toEqual([{
      key: 'field',
      value: '合成富文本字段',
      targetNodeKey: 'D1',
    }]);
    expect(result.sourceRows[0]?.nodes[0]?.body).toBe('按合成条件核对\n合成富文本操作');
    expect(result.sourceRows[0]?.scripts).toEqual([{
      targetNodeKey: 'D1',
      text: '合成链接显示文本',
      riskLevel: 'unresolved',
    }]);
    expect(JSON.stringify(result.sourceRows)).not.toContain(hyperlink);
  });

  it('preserves branch conditions without targets and unresolved script risk', async () => {
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow({
        路径选择: '合成条件成立时继续',
        话术: '合成未决风险话术',
        快捷语: '合成快捷回复',
      })],
    }));

    expectProjects(result);
    expect(result.sourceRows[0]?.paths).toEqual([{
      fromNodeKey: 'D1',
      toNodeKey: null,
      condition: '合成条件成立时继续',
    }]);
    expect(result.sourceRows[0]?.scripts).toEqual([{
      targetNodeKey: 'D1',
      text: '合成未决风险话术',
      riskLevel: 'unresolved',
    }]);
    expect(result.sourceRows[0]?.quickPhrases).toEqual([{
      targetNodeKey: 'D1',
      text: '合成快捷回复',
    }]);

    const projection = projectMenokinSopSourceRows(result.sourceRows);
    const branch = projection.candidate?.tables.decisionBranches.rows[0];
    const script = projection.candidate?.tables.customerScripts.rows[0];
    expect(branch?.targetNodeKey).toBeNull();
    expect(branch?.blockers.map((item) => item.code)).toContain('BRANCH_TARGET_UNRESOLVED');
    expect(script?.riskLevel).toBe('unresolved');
    expect(script?.blockers.map((item) => item.code)).toContain('SCRIPT_RISK_UNRESOLVED');
  });

  it('hashes external image text without returning its URL and keeps it as an external blocker', async () => {
    const reference = 'https://synthetic.example/image.png';
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow({ 图片: reference })],
    }));

    expectProjects(result);
    expect(result.sourceRows[0]?.images).toEqual([{
      referenceKind: 'external',
      columnNumber: 18,
      contentSha256: null,
      referenceHash: hash(reference),
      mime: null,
      bytes: null,
      targetNodeKey: 'D1',
    }]);
    expect(JSON.stringify(result.sourceRows)).not.toContain(reference);
    const projection = projectMenokinSopSourceRows(result.sourceRows);
    expect(projection.candidate?.tables.resourcesImages.rows[0]?.blockers.map((item) => item.code))
      .toContain('MEDIA_EXTERNAL_REFERENCE');
  });

  it('turns image formula, hyperlink and numeric cells into opaque external hashes', async () => {
    const formula = 'HYPERLINK("https://synthetic.example/formula-target","合成公式图片")';
    const hyperlinkText = '合成链接图片';
    const hyperlink = 'https://synthetic.example/hyperlink-target';
    const opaqueNumber = 987_654_321;
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [
        syntheticRow({ 步骤: 'D1' }),
        syntheticRow({ 步骤: 'D7' }),
        syntheticRow({ 步骤: 'DS' }),
      ],
      mutate: (_book, sheet) => {
        sheet.getCell('R2').value = {
          formula,
          result: '无',
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('R3').value = {
          text: hyperlinkText,
          hyperlink,
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('R4').value = opaqueNumber;
      },
    }));

    expectProjects(result);
    expect(result.sourceRows.map((row) => row.images[0])).toEqual([
      expect.objectContaining({
        referenceKind: 'external',
        columnNumber: 18,
        contentSha256: null,
        referenceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        mime: null,
        bytes: null,
        targetNodeKey: 'D1',
      }),
      expect.objectContaining({
        referenceKind: 'external',
        columnNumber: 18,
        referenceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        targetNodeKey: 'D7',
      }),
      expect.objectContaining({
        referenceKind: 'external',
        columnNumber: 18,
        referenceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        targetNodeKey: 'DS',
      }),
    ]);
    const serialized = JSON.stringify(result.sourceRows);
    expect(serialized).not.toContain(formula);
    expect(serialized).not.toContain(hyperlinkText);
    expect(serialized).not.toContain(hyperlink);
    expect(serialized).not.toContain(String(opaqueNumber));
    const projection = projectMenokinSopSourceRows(result.sourceRows);
    expect(projection.candidate?.tables.resourcesImages.rows.every((row) =>
      row.blockers.some((blocker) => blocker.code === 'MEDIA_EXTERNAL_REFERENCE'))).toBe(true);
  });

  it('does not create image resources for whitespace or "无" image placeholders', async () => {
    const hyperlink = 'https://synthetic.example/placeholder-target';
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [
        syntheticRow({ 步骤: 'D1', 图片: '   ' }),
        syntheticRow({ 步骤: 'D7' }),
        syntheticRow({ 步骤: 'DS', 图片: '无' }),
      ],
      mutate: (_book, sheet) => {
        sheet.getCell('R3').value = {
          text: ' 无 ',
          hyperlink,
        } as unknown as ExcelJS.CellValue;
      },
    }));

    expectProjects(result);
    expect(result.sourceRows.map((row) => row.images)).toEqual([[], [], []]);
    expect(JSON.stringify(result.sourceRows)).not.toContain(hyperlink);
    expect(projectMenokinSopSourceRows(result.sourceRows).candidate?.tables.resourcesImages.rows)
      .toEqual([]);
  });

  it('keeps bounded metadata for a safely extracted same-row embedded image', async () => {
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow()],
      imageRows: [2],
    }));

    expectProjects(result);
    const contentSha256 = createHash('sha256').update(ONE_PIXEL_PNG_BYTES).digest('hex');
    expect(result.sourceRows[0]?.images).toEqual([{
      referenceKind: 'embedded',
      columnNumber: 18,
      contentSha256,
      referenceHash: null,
      mime: 'image/png',
      bytes: ONE_PIXEL_PNG_BYTES.length,
      targetNodeKey: 'D1',
    }]);
    expect(result.sourceRows[0]?.images[0]?.contentSha256)
      .toBe(contentSha256);
    expect(JSON.stringify(result.sourceRows)).not.toContain(ONE_PIXEL_PNG);
  });

  it('uses direct WPS DISPIMG facts without creating duplicate external references', async () => {
    const imageName = 'ID_0123456789ABCDEF0123456789ABCDEF';
    const externalReference = 'https://synthetic.example/wps-external.png';
    const hyperlink = 'https://synthetic.example/wps-hyperlink';
    const ordinaryFormula = 'HYPERLINK("https://synthetic.example/wps-formula","合成公式")';
    const baseBytes = await workbookBytes({
      rows: [
        syntheticRow({ 作用: 'WPS 图片行' }),
        syntheticRow({ 作用: '外链行', 步骤: 'D7', 图片: externalReference }),
        syntheticRow({ 作用: '超链接行', 步骤: 'DS', 图片: '合成超链接图片' }),
        syntheticRow({ 作用: '普通公式行', 步骤: 'E1' }),
      ],
      mutate: (_book, sheet) => {
        sheet.getCell('R2').value = {
          formula: `_xlfn.DISPIMG("${imageName}",1)`,
          result: 'cached-value-must-be-ignored',
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('R4').value = {
          text: '合成超链接图片',
          hyperlink,
        } as unknown as ExcelJS.CellValue;
        sheet.getCell('R5').value = {
          formula: ordinaryFormula,
          result: '合成公式缓存',
        } as unknown as ExcelJS.CellValue;
      },
    });
    const bytes = await withWpsCellImage(baseBytes, imageName, ONE_PIXEL_PNG_BYTES);
    const result = await parseMenokinFlatSopWorkbook(bytes);

    expectProjects(result);
    const embedded = result.sourceRows.flatMap((row) => row.images).filter((image) => image.referenceKind === 'embedded');
    const external = result.sourceRows.flatMap((row) => row.images).filter((image) => image.referenceKind === 'external');
    expect(embedded).toEqual([{
      referenceKind: 'embedded',
      columnNumber: 18,
      contentSha256: createHash('sha256').update(ONE_PIXEL_PNG_BYTES).digest('hex'),
      referenceHash: null,
      mime: 'image/png',
      bytes: ONE_PIXEL_PNG_BYTES.length,
      targetNodeKey: 'D1',
    }]);
    expect(external).toHaveLength(3);
    expect(external.every((image) => image.contentSha256 === null && image.referenceHash?.match(/^[0-9a-f]{64}$/u)))
      .toBe(true);
    const serialized = JSON.stringify(result.sourceRows);
    expect(serialized).not.toContain(imageName);
    expect(serialized).not.toContain('DISPIMG');
    expect(serialized).not.toContain('cellimages.xml');
    expect(serialized).not.toContain('rId1');
    expect(serialized).not.toContain('cached-value-must-be-ignored');
    expect(serialized).not.toContain(externalReference);
    expect(serialized).not.toContain(hyperlink);
    expect(serialized).not.toContain(ordinaryFormula);
    expect(serialized).not.toContain(ONE_PIXEL_PNG);
  });

  it('returns the same source hash when the same bytes are parsed repeatedly', async () => {
    const bytes = await workbookBytes({ rows: [syntheticRow()] });
    const first = await parseMenokinFlatSopWorkbook(bytes);
    const second = await parseMenokinFlatSopWorkbook(bytes);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.sourceSha256).toBe(first.sourceSha256);
    expect(second.sourceRows).toEqual(first.sourceRows);
  });

  it('fails closed for missing and duplicate headers', async () => {
    const missing = await parseMenokinFlatSopWorkbook(await workbookBytes({
      headers: MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.filter((header) => header !== '图片'),
      rows: [syntheticRow()],
    }));
    expect(missing.ok).toBe(false);
    expect(missing.sourceRows).toEqual([]);
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_HEADER', column: 'R' }));

    const duplicateHeaders = [...MENOKIN_FLAT_SOP_WORKBOOK_HEADERS];
    duplicateHeaders[1] = duplicateHeaders[0]!;
    const duplicate = await parseMenokinFlatSopWorkbook(await workbookBytes({
      headers: duplicateHeaders,
      rows: [syntheticRow()],
    }));
    expect(duplicate.ok).toBe(false);
    expect(duplicate.sourceRows).toEqual([]);
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_HEADER', column: 'B' }));
  });

  it('rejects an extra worksheet and duplicate source rows without returning partial rows', async () => {
    const extraSheet = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow()],
      extraSheet: true,
    }));
    expect(extraSheet.ok).toBe(false);
    expect(extraSheet.sourceRows).toEqual([]);
    expect(extraSheet.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SHEET', sheet: '合成额外页' }));

    const duplicateRow = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow(), syntheticRow()],
    }));
    expect(duplicateRow.ok).toBe(false);
    expect(duplicateRow.sourceRows).toEqual([]);
    expect(duplicateRow.issues).toContainEqual(expect.objectContaining({
      code: 'DUPLICATE_SOURCE_ROW',
      row: 3,
      field: '$[1]',
    }));
  });

  it('rejects a group outside the five approved SOP groups', async () => {
    const result = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow({ SOP归属: '合成未批准分组' })],
    }));

    expect(result.ok).toBe(false);
    expect(result.sourceRows).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_SOP_GROUP',
      row: 2,
      column: 'E',
      field: 'SOP归属',
    }));
  });

  it('enforces caller-tightened row and text-cell boundaries', async () => {
    const overBudget = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow(), syntheticRow({ 步骤: 'D7' })],
    }), { maxRows: 1 });
    expect(overBudget.ok).toBe(false);
    expect(overBudget.sourceRows).toEqual([]);
    expect(overBudget.issues).toContainEqual(expect.objectContaining({ code: 'ROW_LIMIT', row: 3 }));

    const nonText = await parseMenokinFlatSopWorkbook(await workbookBytes({
      rows: [syntheticRow()],
      mutate: (_book, sheet) => {
        sheet.getCell('D2').value = {
          formula: 'SYNTHETIC_FORMULA()',
          result: '合成结果',
        } as unknown as ExcelJS.CellValue;
      },
    }));
    expect(nonText.ok).toBe(false);
    expect(nonText.sourceRows).toEqual([]);
    expect(nonText.issues).toContainEqual(expect.objectContaining({
      code: 'NON_TEXT_CELL',
      row: 2,
      column: 'D',
      field: '作用',
    }));
  });
});
