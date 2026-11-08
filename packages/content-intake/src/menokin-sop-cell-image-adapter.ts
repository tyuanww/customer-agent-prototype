import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
import yauzl from 'yauzl';
import { inspectArchive } from './archive.js';
import { INTAKE_POLICY, IntakeFailure } from './policy.js';

const WPS_COLUMN_NUMBER = 18 as const;
const WPS_CELL_IMAGE_RELATIONSHIP_SUFFIX = '/cellImage';
const WPS_FORMULA = /^_xlfn\.DISPIMG\("(ID_[0-9A-Fa-f]{32})",1\)$/u;
const WPS_FORMULA_FAMILY = /_xlfn\.DISPIMG\s*\(/u;
const MAX_WORKBOOK_XML_BYTES = INTAKE_POLICY.oneMediaBytes;
const MAX_FORMULA_CHARS = 256;

export type WpsCellImageFact = Readonly<{
  rowNumber: number;
  columnNumber: typeof WPS_COLUMN_NUMBER;
  contentSha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: number;
}>;

export type WpsCellImageIssue = Readonly<{
  code: string;
  rowNumber: number | null;
  columnNumber: number | null;
}>;

export type WpsCellImageInspection = Readonly<{
  facts: readonly WpsCellImageFact[];
  issues: readonly WpsCellImageIssue[];
}>;

type ZipReadBudget = { bytes: number };

type FormulaCell = Readonly<{
  imageName: string;
  rowNumber: number;
}>;

type CellImageDefinition = {
  imageName: string | null;
  relationshipId: string | null;
  names: number;
  embeds: number;
};

type CellImageRelationship = Readonly<{
  target: string | null;
  external: boolean;
  duplicate: boolean;
}>;

class AdapterFailure extends Error {
  constructor(
    readonly code: string,
    readonly rowNumber: number | null = null,
    readonly columnNumber: number | null = null,
  ) {
    super(code);
  }
}

const openZip = async (bytes: Buffer): Promise<yauzl.ZipFile> => new Promise((resolve, reject) => {
  yauzl.fromBuffer(
    bytes,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
    (error, zip) => error || !zip ? reject(new IntakeFailure('INVALID_ZIP')) : resolve(zip),
  );
});

/** Read only named package parts. The caller first runs `inspectArchive`, and this
 * second pass applies its own cumulative byte, part-size and requested-part limits. */
const readZipParts = async (
  bytes: Buffer,
  requested: readonly string[],
  budget: ZipReadBudget,
): Promise<ReadonlyMap<string, Buffer>> => {
  if (requested.length > INTAKE_POLICY.zipEntries) throw new IntakeFailure('ZIP_ENTRY_LIMIT');
  const wanted = new Set(requested);
  if (wanted.size !== requested.length) throw new IntakeFailure('AMBIGUOUS_PACKAGE_PART');
  const found = new Map<string, Buffer>();
  const zip = await openZip(bytes);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error instanceof IntakeFailure ? error : new IntakeFailure('INVALID_ZIP'));
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(found);
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!wanted.has(entry.fileName)) {
          zip.readEntry();
          return;
        }
        const read = async () => {
          if (entry.isEncrypted() || entry.fileName.endsWith('/')) {
            throw new IntakeFailure('INVALID_PACKAGE_PART');
          }
          if (entry.uncompressedSize > MAX_WORKBOOK_XML_BYTES
            || budget.bytes + entry.uncompressedSize > INTAKE_POLICY.expandedBytes) {
            throw new IntakeFailure('EXPANDED_LIMIT');
          }
          const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, value) => error || !value
              ? rejectStream(new IntakeFailure('INVALID_PACKAGE_PART'))
              : resolveStream(value));
          });
          const chunks: Buffer[] = [];
          let actual = 0;
          for await (const chunk of stream) {
            const part = chunk as Buffer;
            actual += part.length;
            budget.bytes += part.length;
            if (actual > MAX_WORKBOOK_XML_BYTES || budget.bytes > INTAKE_POLICY.expandedBytes) {
              throw new IntakeFailure('EXPANDED_LIMIT');
            }
            chunks.push(part);
          }
          if (actual !== entry.uncompressedSize) throw new IntakeFailure('ZIP_SIZE_MISMATCH');
          found.set(entry.fileName, Buffer.concat(chunks, actual));
        };
        void read().then(() => { if (!settled) zip.readEntry(); }, fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
};

const xmlParser = (): SaxesParser => {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw new AdapterFailure('WPS_CELLIMAGE_XML_INVALID'); });
  return parser;
};

const parseXml = (source: Buffer, consume: (parser: SaxesParser) => void, code: string): void => {
  try {
    const parser = xmlParser();
    consume(parser);
    parser.write(source.toString('utf8')).close();
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    throw new AdapterFailure(code);
  }
};

const localName = (name: string): string => name.split(':').at(-1) ?? name;
const isExternalTarget = (target: string): boolean => target === ''
  || target.startsWith('/')
  || target.startsWith('\\')
  || target.includes('\\')
  || /^[a-z][a-z0-9+.-]*:/iu.test(target);

const resolveInternalTarget = (sourcePart: string, target: string): string | null => {
  if (isExternalTarget(target)) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePart), target));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/') || resolved === '.') return null;
  return resolved;
};

const imageMime = (bytes: Buffer): WpsCellImageFact['mime'] | null => {
  if (bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  return null;
};

const relationPartFor = (part: string): string => posix.join(
  posix.dirname(part),
  '_rels',
  `${posix.basename(part)}.rels`,
);

const issue = (
  code: string,
  rowNumber: number | null = null,
  columnNumber: number | null = null,
): WpsCellImageIssue => ({ code, rowNumber, columnNumber });

const workbookMetadata = (
  workbookXml: Buffer,
  workbookRelationshipsXml: Buffer,
  sheetName: string,
): Readonly<{
  sheetPart: string;
  cellImagePart: string | null;
  workbookAbsoluteTarget: boolean;
  workbookExternalTarget: boolean;
}> => {
  const sheets: { name: string; relationshipId: string }[] = [];
  parseXml(workbookXml, (parser) => {
    parser.on('opentag', (tag) => {
      if (localName(tag.name) !== 'sheet') return;
      sheets.push({
        name: String(tag.attributes.name ?? ''),
        relationshipId: String(tag.attributes['r:id'] ?? ''),
      });
    });
  }, 'WPS_CELLIMAGE_WORKBOOK_INVALID');

  const relationships = new Map<string, { target: string; type: string; external: boolean }>();
  let relationshipExternal = false;
  let relationshipAbsoluteTarget = false;
  parseXml(workbookRelationshipsXml, (parser) => {
    parser.on('opentag', (tag) => {
      if (localName(tag.name) !== 'Relationship') return;
      const id = String(tag.attributes.Id ?? '');
      const target = String(tag.attributes.Target ?? '');
      const type = String(tag.attributes.Type ?? '');
      const external = tag.attributes.TargetMode === 'External' || isExternalTarget(target);
      const absolute = target.startsWith('/');
      relationshipExternal ||= external;
      relationshipAbsoluteTarget ||= absolute;
      if (id) relationships.set(id, { target, type, external });
    });
  }, 'WPS_CELLIMAGE_WORKBOOK_RELATION_INVALID');

  const namedSheets = sheets.filter((entry) => entry.name === sheetName);
  if (namedSheets.length !== 1) throw new AdapterFailure('WPS_CELLIMAGE_SHEET_INVALID');
  const sheetRelationship = relationships.get(namedSheets[0]!.relationshipId);
  const sheetPart = sheetRelationship === undefined || sheetRelationship.external
    ? null
    : resolveInternalTarget('xl/workbook.xml', sheetRelationship.target);
  if (sheetPart === null || !sheetPart.startsWith('xl/worksheets/') || !sheetPart.endsWith('.xml')) {
    throw new AdapterFailure('WPS_CELLIMAGE_SHEET_RELATION_INVALID');
  }

  const cellImageRelationships = [...relationships.values()].filter((entry) =>
    entry.type.endsWith(WPS_CELL_IMAGE_RELATIONSHIP_SUFFIX));
  if (cellImageRelationships.length > 1) throw new AdapterFailure('WPS_CELLIMAGE_WORKBOOK_RELATION_DUPLICATE');
  const cellImageRelationship = cellImageRelationships[0];
  const cellImagePart = cellImageRelationship === undefined || cellImageRelationship.external
    ? null
    : resolveInternalTarget('xl/workbook.xml', cellImageRelationship.target);
  if (cellImageRelationship !== undefined
    && (cellImagePart === null || !cellImagePart.startsWith('xl/') || !cellImagePart.endsWith('.xml'))) {
    throw new AdapterFailure('WPS_CELLIMAGE_WORKBOOK_RELATION_OUT_OF_BOUNDS');
  }
  return { sheetPart, cellImagePart, workbookAbsoluteTarget: relationshipAbsoluteTarget, workbookExternalTarget: relationshipExternal };
};

const worksheetFormulas = (sheetXml: Buffer): Readonly<{
  formulas: readonly FormulaCell[];
  invalid: readonly WpsCellImageIssue[];
}> => {
  const formulas: FormulaCell[] = [];
  const invalid: WpsCellImageIssue[] = [];
  const stack: string[] = [];
  let cell: { reference: string; formulas: string[]; formulaText: string | null } | null = null;
  parseXml(sheetXml, (parser) => {
    parser.on('opentag', (tag) => {
      const name = localName(tag.name);
      const parent = stack.at(-1);
      if (name === 'c' && parent === 'row') {
        cell = { reference: String(tag.attributes.r ?? ''), formulas: [], formulaText: null };
      } else if (name === 'f' && cell !== null && parent === 'c') {
        cell.formulaText = '';
        cell.formulas.push('');
      }
      stack.push(name);
    });
    const text = (value: string) => {
      const currentCell = cell;
      if (currentCell === null || currentCell.formulaText === null || stack.at(-1) !== 'f') return;
      currentCell.formulaText += value;
      if (currentCell.formulaText.length > MAX_FORMULA_CHARS) {
        throw new AdapterFailure('WPS_CELLIMAGE_FORMULA_INVALID', null, null);
      }
    };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.on('closetag', (tag) => {
      const name = localName(tag.name);
      stack.pop();
      if (name === 'f' && cell !== null && cell.formulas.length > 0) {
        cell.formulas[cell.formulas.length - 1] = cell.formulaText ?? '';
        cell.formulaText = null;
      } else if (name === 'c' && cell !== null) {
        const coordinate = /^([A-Z]+)([0-9]+)$/u.exec(cell.reference);
        const columnNumber = coordinate === null ? null : [...coordinate[1]!].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
        const rowNumber = coordinate === null || !/^[1-9][0-9]*$/u.test(coordinate[2] ?? '') ? null : Number(coordinate[2]);
        if (cell.formulas.length === 1) {
          const formula = cell.formulas[0]!;
          const match = WPS_FORMULA.exec(formula);
          if (match !== null) {
            if (columnNumber !== null && columnNumber !== WPS_COLUMN_NUMBER) {
              invalid.push(issue('WPS_CELLIMAGE_COLUMN_INVALID', rowNumber, columnNumber));
            } else if (rowNumber === null) {
              invalid.push(issue('WPS_CELLIMAGE_ROW_INVALID', null, columnNumber));
            } else {
              formulas.push({ imageName: match[1]!, rowNumber });
            }
          } else if (WPS_FORMULA_FAMILY.test(formula)) {
            invalid.push(issue('WPS_CELLIMAGE_FORMULA_INVALID', rowNumber, columnNumber));
          }
        } else if (cell.formulas.some((formula) => WPS_FORMULA_FAMILY.test(formula))) {
          invalid.push(issue('WPS_CELLIMAGE_FORMULA_INVALID', rowNumber, columnNumber));
        }
        cell = null;
      }
    });
  }, 'WPS_CELLIMAGE_WORKSHEET_INVALID');
  return { formulas, invalid };
};

const cellImageDefinitions = (
  cellImagesXml: Buffer,
  relationshipsXml: Buffer,
  cellImagesPart: string,
): Readonly<{
  definitions: readonly CellImageDefinition[];
  relationships: ReadonlyMap<string, CellImageRelationship>;
  invalid: readonly WpsCellImageIssue[];
}> => {
  const definitions: CellImageDefinition[] = [];
  const invalid: WpsCellImageIssue[] = [];
  let current: CellImageDefinition | null = null;
  parseXml(cellImagesXml, (parser) => {
    parser.on('opentag', (tag) => {
      const name = localName(tag.name);
      if (name === 'cellImage') {
        if (current !== null) throw new AdapterFailure('WPS_CELLIMAGE_XML_INVALID');
        current = { imageName: null, relationshipId: null, names: 0, embeds: 0 };
      } else if (name === 'cNvPr' && current !== null) {
        current.names += 1;
        if (current.names === 1) current.imageName = String(tag.attributes.name ?? '');
      } else if (name === 'blip' && current !== null) {
        current.embeds += 1;
        if (current.embeds === 1) current.relationshipId = String(tag.attributes['r:embed'] ?? '');
      }
    });
    parser.on('closetag', (tag) => {
      if (localName(tag.name) !== 'cellImage' || current === null) return;
      definitions.push(current);
      current = null;
    });
  }, 'WPS_CELLIMAGE_XML_INVALID');
  if (current !== null) throw new AdapterFailure('WPS_CELLIMAGE_XML_INVALID');

  const seenNames = new Set<string>();
  for (const definition of definitions) {
    if (definition.names !== 1 || definition.embeds !== 1
      || definition.imageName === null || definition.imageName === ''
      || definition.relationshipId === null || definition.relationshipId === '') {
      invalid.push(issue('WPS_CELLIMAGE_DEFINITION_INVALID'));
      continue;
    }
    if (seenNames.has(definition.imageName)) {
      invalid.push(issue('WPS_CELLIMAGE_IMAGE_NAME_DUPLICATE'));
    }
    seenNames.add(definition.imageName);
  }

  const relationships = new Map<string, CellImageRelationship>();
  parseXml(relationshipsXml, (parser) => {
    parser.on('opentag', (tag) => {
      if (localName(tag.name) !== 'Relationship') return;
      const id = String(tag.attributes.Id ?? '');
      const target = String(tag.attributes.Target ?? '');
      const external = tag.attributes.TargetMode === 'External' || isExternalTarget(target);
      const duplicate = relationships.has(id);
      if (!id) {
        invalid.push(issue('WPS_CELLIMAGE_RELATION_DUPLICATE'));
        return;
      }
      relationships.set(id, {
        target: external ? null : resolveInternalTarget(cellImagesPart, target),
        external,
        duplicate: duplicate || (relationships.get(id)?.duplicate ?? false),
      });
      if (duplicate) invalid.push(issue('WPS_CELLIMAGE_RELATION_DUPLICATE'));
    });
  }, 'WPS_CELLIMAGE_RELATION_INVALID');
  return { definitions, relationships, invalid };
};

/**
 * Resolve WPS cell images from their direct worksheet formulas. This adapter
 * returns only bounded media facts; names, relationship IDs, package paths,
 * formulas and image bytes remain inside this module.
 */
export async function inspectMenokinWpsCellImages(
  bytes: Buffer,
  sheetName: string,
): Promise<WpsCellImageInspection> {
  if (!Buffer.isBuffer(bytes)) return { facts: [], issues: [issue('INVALID_BYTES', null, WPS_COLUMN_NUMBER)] };
  try {
    await inspectArchive(bytes, { allowExternalHyperlinks: true });
    const budget: ZipReadBudget = { bytes: 0 };
    const workbookParts = await readZipParts(bytes, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'], budget);
    const workbookXml = workbookParts.get('xl/workbook.xml');
    const workbookRelationshipsXml = workbookParts.get('xl/_rels/workbook.xml.rels');
    if (workbookXml === undefined || workbookRelationshipsXml === undefined) {
      throw new AdapterFailure('WPS_CELLIMAGE_WORKBOOK_RELATION_INVALID');
    }
    const metadata = workbookMetadata(workbookXml, workbookRelationshipsXml, sheetName);
    const initialParts = await readZipParts(bytes, [metadata.sheetPart], budget);
    const sheetXml = initialParts.get(metadata.sheetPart);
    if (sheetXml === undefined) throw new AdapterFailure('WPS_CELLIMAGE_SHEET_MISSING');
    const { formulas, invalid } = worksheetFormulas(sheetXml);
    if (metadata.cellImagePart === null) {
      if (formulas.length === 0 && invalid.length === 0) return { facts: [], issues: [] };
      return {
        facts: [],
        issues: [
          ...invalid,
          ...formulas.map((entry) => issue('WPS_CELLIMAGE_WORKBOOK_RELATION_MISSING', entry.rowNumber, WPS_COLUMN_NUMBER)),
        ],
      };
    }

    const cellImagesRelationshipsPart = relationPartFor(metadata.cellImagePart);
    const cellImageParts = await readZipParts(
      bytes,
      [metadata.cellImagePart, cellImagesRelationshipsPart],
      budget,
    );
    const cellImagesXml = cellImageParts.get(metadata.cellImagePart);
    const relationshipsXml = cellImageParts.get(cellImagesRelationshipsPart);
    if (cellImagesXml === undefined) throw new AdapterFailure('WPS_CELLIMAGE_PART_MISSING');
    if (relationshipsXml === undefined) throw new AdapterFailure('WPS_CELLIMAGE_RELATION_PART_MISSING');
    const parsed = cellImageDefinitions(cellImagesXml, relationshipsXml, metadata.cellImagePart);
    const issues = [...invalid, ...parsed.invalid];
    const usesByName = new Map<string, number[]>();
    for (const formula of formulas) {
      const rows = usesByName.get(formula.imageName) ?? [];
      rows.push(formula.rowNumber);
      usesByName.set(formula.imageName, rows);
    }
    for (const rows of usesByName.values()) {
      if (rows.length > 1) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_ANCHOR_DUPLICATE', rowNumber, WPS_COLUMN_NUMBER)));
      }
    }
    const definitionsByName = new Map<string, CellImageDefinition>();
    for (const definition of parsed.definitions) {
      if (definition.imageName !== null && definition.relationshipId !== null) {
        definitionsByName.set(definition.imageName, definition);
      }
    }
    for (const [imageName, rows] of usesByName) {
      if (!definitionsByName.has(imageName)) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_DEFINITION_MISSING', rowNumber, WPS_COLUMN_NUMBER)));
      }
    }
    for (const definition of parsed.definitions) {
      if (definition.imageName !== null && !usesByName.has(definition.imageName)) {
        issues.push(issue('WPS_CELLIMAGE_DEFINITION_FREE'));
      }
    }

    const mediaByPart = new Map<string, Buffer>();
    const mediaParts = new Set<string>();
    for (const definition of parsed.definitions) {
      if (definition.imageName === null || definition.relationshipId === null) continue;
      const rows = usesByName.get(definition.imageName) ?? [];
      const relationship = parsed.relationships.get(definition.relationshipId);
      if (relationship === undefined) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_RELATION_MISSING', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      if (relationship.duplicate) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_RELATION_DUPLICATE', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      if (relationship.external) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_RELATION_EXTERNAL', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      if (relationship.target === null || !relationship.target.startsWith('xl/media/')) {
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_RELATION_OUT_OF_BOUNDS', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      mediaParts.add(relationship.target);
    }
    if (mediaParts.size > 0) {
      const media = await readZipParts(bytes, [...mediaParts].sort(), budget);
      for (const [part, value] of media) mediaByPart.set(part, value);
    }

    const facts: WpsCellImageFact[] = [];
    for (const definition of parsed.definitions) {
      if (definition.imageName === null || definition.relationshipId === null) continue;
      const relationship = parsed.relationships.get(definition.relationshipId);
      if (relationship === undefined || relationship.external || relationship.duplicate || relationship.target === null) continue;
      const bytesForImage = mediaByPart.get(relationship.target);
      if (bytesForImage === undefined) {
        const rows = usesByName.get(definition.imageName) ?? [];
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_MEDIA_MISSING', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      const mime = imageMime(bytesForImage);
      if (mime === null) {
        const rows = usesByName.get(definition.imageName) ?? [];
        issues.push(...rows.map((rowNumber) => issue('WPS_CELLIMAGE_SIGNATURE_UNSUPPORTED', rowNumber, WPS_COLUMN_NUMBER)));
        continue;
      }
      const contentSha256 = createHash('sha256').update(bytesForImage).digest('hex');
      for (const rowNumber of usesByName.get(definition.imageName) ?? []) {
        facts.push({
          rowNumber,
          columnNumber: WPS_COLUMN_NUMBER,
          contentSha256,
          mime,
          bytes: bytesForImage.length,
        });
      }
    }
    if (issues.length > 0) return { facts: [], issues };
    facts.sort((left, right) => left.rowNumber - right.rowNumber);
    return { facts, issues: [] };
  } catch (error) {
    if (error instanceof AdapterFailure) return { facts: [], issues: [issue(error.code, error.rowNumber, error.columnNumber)] };
    if (error instanceof IntakeFailure) return { facts: [], issues: [issue(error.code)] };
    return { facts: [], issues: [issue('WPS_CELLIMAGE_XML_INVALID')] };
  }
}
