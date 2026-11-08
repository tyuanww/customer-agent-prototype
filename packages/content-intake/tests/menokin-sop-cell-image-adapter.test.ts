import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inspectMenokinWpsCellImages } from '../src/menokin-sop-cell-image-adapter.js';

const SHEET_NAME = '特殊流程 SOP';
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ff0000', 'hex');
const GIF = Buffer.from('4749463839610000', 'hex');

type FormulaFixture = Readonly<{
  reference: string;
  imageName: string;
  formula?: string;
  cached?: string;
  direct?: boolean;
}>;

type DefinitionFixture = Readonly<{
  imageName: string | null;
  relationshipId: string | null;
  extraName?: string | null;
  extraRelationshipId?: string | null;
}>;

type RelationshipFixture = Readonly<{
  id: string;
  target: string;
  mode?: 'External';
}>;

type MediaFixture = Readonly<{
  path: string;
  bytes: Buffer;
}>;

type PackageFixture = Readonly<{
  sheetName?: string;
  formulas?: readonly FormulaFixture[];
  definitions?: readonly DefinitionFixture[];
  workbookCellImage?: boolean;
  relationships?: readonly RelationshipFixture[];
  media?: readonly MediaFixture[];
}>;

const imageName = (index: number): string => `ID_${index.toString(16).padStart(32, '0').toUpperCase()}`;
const formulaFor = (name: string): string => `_xlfn.DISPIMG("${name}",1)`;
const relationship = (index: number): RelationshipFixture => ({
  id: `rId${index}`,
  target: `media/image${index}.png`,
});
const definition = (index: number): DefinitionFixture => ({
  imageName: imageName(index),
  relationshipId: `rId${index}`,
});

function formulaXml(formula: FormulaFixture): string {
  const text = formula.formula ?? formulaFor(formula.imageName);
  const encoded = text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const formulaNode = `<f>${encoded}</f>`;
  if (formula.direct === false) {
    return `<c r="${formula.reference}" t="str"><ext>${formulaNode}</ext><v>${formula.cached ?? ''}</v></c>`;
  }
  return `<c r="${formula.reference}" t="str">${formulaNode}<v>${formula.cached ?? ''}</v></c>`;
}

async function packageBytes(fixture: PackageFixture = {}): Promise<Buffer> {
  const zip = new JSZip();
  const formulas = fixture.formulas ?? [];
  const definitions = fixture.definitions ?? [];
  const relationships = fixture.relationships ?? [];
  const media = fixture.media ?? [];
  const worksheetRows = formulas.map((formula) => {
    const row = /[0-9]+$/u.exec(formula.reference)?.[0] ?? '2';
    return `<row r="${row}">${formulaXml(formula)}</row>`;
  }).join('');
  const definitionsXml = definitions.map((entry) => {
    const names = [
      ...(entry.imageName === null ? [] : [`<xdr:cNvPr id="1" name="${entry.imageName}"/>`]),
      ...(entry.extraName === undefined || entry.extraName === null ? [] : [`<xdr:cNvPr id="2" name="${entry.extraName}"/>`]),
    ].join('');
    const embeds = [
      ...(entry.relationshipId === null ? [] : [`<a:blip r:embed="${entry.relationshipId}"/>`]),
      ...(entry.extraRelationshipId === undefined || entry.extraRelationshipId === null
        ? []
        : [`<a:blip r:embed="${entry.extraRelationshipId}"/>`]),
    ].join('');
    return `<etc:cellImage><xdr:pic><xdr:nvPicPr>${names}</xdr:nvPicPr><xdr:blipFill>${embeds}</xdr:blipFill></xdr:pic></etc:cellImage>`;
  }).join('');
  const relationshipsXml = relationships.map((entry) => `<Relationship Id="${entry.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${entry.target}"${entry.mode === undefined ? '' : ` TargetMode="${entry.mode}"`}/>`).join('');
  const relationEntry = fixture.workbookCellImage === false
    ? ''
    : '<Relationship Id="rIdCellImage" Type="http://schemas.microsoft.com/office/2017/06/relationships/cellImage" Target="cellimages.xml"/>';

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${fixture.sheetName ?? SHEET_NAME}" sheetId="1" r:id="rIdWorksheet"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorksheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${relationEntry}</Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheetRows}</sheetData></worksheet>`);
  zip.file('xl/cellimages.xml', `<?xml version="1.0" encoding="UTF-8"?><etc:cellImages xmlns:etc="http://schemas.microsoft.com/office/spreadsheetml/2017/06/main" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${definitionsXml}</etc:cellImages>`);
  zip.file('xl/_rels/cellimages.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationshipsXml}</Relationships>`);
  for (const entry of media) zip.file(entry.path, entry.bytes);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('Menokin WPS cell-image adapter', () => {
  it('maps 14 formula cells to package media without exposing WPS identifiers', async () => {
    const formats = [PNG, JPEG, GIF] as const;
    const formulas = Array.from({ length: 14 }, (_, index) => ({
      reference: `R${index + 3}`,
      imageName: imageName(index + 1),
      cached: `cached-${index + 1}`,
    }));
    const definitions = formulas.map((entry, index) => definition(index + 1));
    const relationships = definitions.map((_entry, index) => relationship(index + 1));
    const media = relationships.map((entry, index) => ({
      path: `xl/media/image${index + 1}.png`,
      bytes: Buffer.concat([formats[index % formats.length]!, Buffer.from([index + 1])]),
    }));
    const result = await inspectMenokinWpsCellImages(await packageBytes({
      formulas,
      definitions,
      relationships,
      media,
    }), SHEET_NAME);

    expect(result.issues).toEqual([]);
    expect(result.facts.map((fact) => fact.rowNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(result.facts.map((fact) => fact.mime)).toEqual(Array.from({ length: 14 }, (_, index) =>
      index % 3 === 0 ? 'image/png' : index % 3 === 1 ? 'image/jpeg' : 'image/gif'));
    expect(result.facts[0]).toEqual({
      rowNumber: 3,
      columnNumber: 18,
      contentSha256: hash(media[0]!.bytes),
      mime: 'image/png',
      bytes: media[0]!.bytes.length,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(formulas[0]!.imageName);
    expect(serialized).not.toContain('DISPIMG');
    expect(serialized).not.toContain('rId1');
    expect(serialized).not.toContain('cellimages.xml');
    expect(serialized).not.toContain(PNG.toString('base64').slice(0, 16));
  });

  it('binds rows by formula identity while ignoring cached values', async () => {
    const bytes = await packageBytes({
      formulas: [
        { reference: 'R7', imageName: imageName(1), cached: 'looks-like-image-2' },
        { reference: 'R9', imageName: imageName(2), cached: 'looks-like-image-1' },
      ],
      definitions: [definition(1), definition(2)],
      relationships: [relationship(1), relationship(2)],
      media: [
        { path: 'xl/media/image1.png', bytes: PNG },
        { path: 'xl/media/image2.png', bytes: JPEG },
      ],
    });
    const first = await inspectMenokinWpsCellImages(bytes, SHEET_NAME);
    const second = await inspectMenokinWpsCellImages(bytes, SHEET_NAME);

    expect(first).toEqual(second);
    expect(first.issues).toEqual([]);
    expect(first.facts.map((fact) => [fact.rowNumber, fact.contentSha256])).toEqual([
      [7, hash(PNG)],
      [9, hash(JPEG)],
    ]);
  });

  it('fails closed for formulas outside the R image column and malformed DISPIMG IDs', async () => {
    const nonImageColumn = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'Q2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [relationship(1)],
      media: [{ path: 'xl/media/image1.png', bytes: PNG }],
    }), SHEET_NAME);
    expect(nonImageColumn.facts).toEqual([]);
    expect(nonImageColumn.issues).toContainEqual({ code: 'WPS_CELLIMAGE_COLUMN_INVALID', rowNumber: 2, columnNumber: 17 });

    const badId = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1), formula: '_xlfn.DISPIMG("ID_not-32-hex",1)' }],
      definitions: [definition(1)],
      relationships: [relationship(1)],
      media: [{ path: 'xl/media/image1.png', bytes: PNG }],
    }), SHEET_NAME);
    expect(badId.facts).toEqual([]);
    expect(badId.issues).toContainEqual({ code: 'WPS_CELLIMAGE_FORMULA_INVALID', rowNumber: 2, columnNumber: 18 });
  });

  it('fails closed when DISPIMG has no workbook cellImage relationship', async () => {
    const result = await inspectMenokinWpsCellImages(await packageBytes({
      workbookCellImage: false,
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
    }), SHEET_NAME);

    expect(result.facts).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_WORKBOOK_RELATION_MISSING',
      rowNumber: 2,
      columnNumber: 18,
    });
  });

  it('allows a non-WPS workbook without cell images to continue unchanged', async () => {
    const result = await inspectMenokinWpsCellImages(await packageBytes({
      workbookCellImage: false,
      formulas: [{ reference: 'R2', imageName: imageName(1), formula: 'SUM(1,2)' }],
    }), SHEET_NAME);

    expect(result).toEqual({ facts: [], issues: [] });
  });

  it('fails closed for missing relations and media', async () => {
    const missingRelation = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [],
      media: [{ path: 'xl/media/image1.png', bytes: PNG }],
    }), SHEET_NAME);
    expect(missingRelation.facts).toEqual([]);
    expect(missingRelation.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_RELATION_MISSING',
      rowNumber: 2,
      columnNumber: 18,
    });

    const missingMedia = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [relationship(1)],
    }), SHEET_NAME);
    expect(missingMedia.facts).toEqual([]);
    expect(missingMedia.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_MEDIA_MISSING',
      rowNumber: 2,
      columnNumber: 18,
    });
  });

  it('fails closed for duplicate names and free WPS definitions', async () => {
    const duplicate = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [
        { reference: 'R2', imageName: imageName(1) },
        { reference: 'R3', imageName: imageName(1) },
      ],
      definitions: [definition(1), { imageName: imageName(1), relationshipId: 'rId2' }],
      relationships: [relationship(1), relationship(2)],
      media: [
        { path: 'xl/media/image1.png', bytes: PNG },
        { path: 'xl/media/image2.png', bytes: JPEG },
      ],
    }), SHEET_NAME);
    expect(duplicate.facts).toEqual([]);
    expect(duplicate.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_IMAGE_NAME_DUPLICATE',
      rowNumber: null,
      columnNumber: null,
    });
    expect(duplicate.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_ANCHOR_DUPLICATE',
      rowNumber: 2,
      columnNumber: 18,
    });
    expect(duplicate.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_ANCHOR_DUPLICATE',
      rowNumber: 3,
      columnNumber: 18,
    });

    const free = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1), definition(2)],
      relationships: [relationship(1), relationship(2)],
      media: [
        { path: 'xl/media/image1.png', bytes: PNG },
        { path: 'xl/media/image2.png', bytes: JPEG },
      ],
    }), SHEET_NAME);
    expect(free.facts).toEqual([]);
    expect(free.issues).toContainEqual({ code: 'WPS_CELLIMAGE_DEFINITION_FREE', rowNumber: null, columnNumber: null });
  });

  it('fails closed for external, out-of-bounds and dangling image relationships', async () => {
    const external = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [{ id: 'rId1', target: 'https://synthetic.example/image.png', mode: 'External' }],
      media: [],
    }), SHEET_NAME);
    expect(external.facts).toEqual([]);
    expect(external.issues.length).toBeGreaterThan(0);

    const outside = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [{ id: 'rId1', target: '../../../../media/image1.png' }],
      media: [{ path: 'xl/media/image1.png', bytes: PNG }],
    }), SHEET_NAME);
    expect(outside.facts).toEqual([]);
    expect(outside.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_RELATION_OUT_OF_BOUNDS',
      rowNumber: 2,
      columnNumber: 18,
    });
  });

  it('fails closed for unsupported signatures and formulas nested outside direct cells', async () => {
    const signature = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1) }],
      definitions: [definition(1)],
      relationships: [relationship(1)],
      media: [{ path: 'xl/media/image1.png', bytes: Buffer.from('not-an-image') }],
    }), SHEET_NAME);
    expect(signature.facts).toEqual([]);
    expect(signature.issues).toContainEqual({
      code: 'WPS_CELLIMAGE_SIGNATURE_UNSUPPORTED',
      rowNumber: 2,
      columnNumber: 18,
    });

    const nested = await inspectMenokinWpsCellImages(await packageBytes({
      formulas: [{ reference: 'R2', imageName: imageName(1), direct: false }],
      definitions: [definition(1)],
      relationships: [relationship(1)],
      media: [{ path: 'xl/media/image1.png', bytes: PNG }],
    }), SHEET_NAME);
    expect(nested.facts).toEqual([]);
    expect(nested.issues).toContainEqual({ code: 'WPS_CELLIMAGE_DEFINITION_FREE', rowNumber: null, columnNumber: null });
  });
});
