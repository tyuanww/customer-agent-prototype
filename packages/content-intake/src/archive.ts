import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { StringDecoder } from 'node:string_decoder';
import { posix } from 'node:path';
import { INTAKE_POLICY as P, IntakeFailure } from './policy.js';

/** Inspect every member, including excluded sheets, before the object-model parser can
 * allocate sparse rows or inflate buffers. No XML, macro, hyperlink or image is executed. */
export async function inspectArchive(bytes: Buffer): Promise<{ expandedBytes: number; mediaCount: number; resourceSheets: readonly string[] }> {
  if (bytes.length > P.fileBytes) throw new IntakeFailure('FILE_TOO_LARGE');
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new IntakeFailure('INVALID_XLSX');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, value) => error || !value ? reject(new IntakeFailure('INVALID_ZIP')) : resolve(value));
  });
  let expandedBytes = 0, mediaCount = 0, mediaBytes = 0, cells = 0, strings = 0;
  const paths = new Set<string>();
  const resources = new Set<string>(), sheets = new Map<string, string>(), relations = new Map<string, string>();
  const coordinate = (value: string) => {
    const match = /^([A-Z]+)([1-9][0-9]*)$/u.exec(value);
    if (!match) throw new IntakeFailure('INVALID_COORDINATE');
    let column = 0;
    for (const letter of match[1]!) column = column * 26 + letter.charCodeAt(0) - 64;
    if (column > P.columns || Number(match[2]) > P.rows + 1) throw new IntakeFailure('COORDINATE_LIMIT');
    return Number(match[2]);
  };
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error instanceof IntakeFailure ? error : new IntakeFailure('INVALID_ZIP_XML'));
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (!paths.has('xl/workbook.xml') || !paths.has('[Content_Types].xml')) {
          reject(new IntakeFailure('INVALID_XLSX')); return;
        }
        const resourceSheets = [...sheets].filter(([, relation]) => {
          const target = relations.get(relation);
          return target !== undefined && resources.has(posix.normalize(posix.join('xl', target)));
        }).map(([name]) => name);
        resolve({ expandedBytes, mediaCount, resourceSheets });
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        const inspect = async () => {
          const name = entry.fileName;
          if (paths.size >= P.zipEntries) throw new IntakeFailure('ZIP_ENTRY_LIMIT');
          if (paths.has(name) || name.includes('\\') || name.split('/').some((part, index, all) => part === '..' || part === '.' || (!part && index !== all.length - 1)) || name.startsWith('/')) {
            throw new IntakeFailure('UNSAFE_ZIP_PATH');
          }
          // yauzl names members from the central directory; JSZip uses the local name.
          // The fixed-template probe accepts canonical ASCII part names only, so both
          // parsers must inspect precisely the same members with no Unicode path alias.
          const offset = entry.relativeOffsetOfLocalHeader;
          if (!/^[\x20-\x7e]+$/u.test(name) || entry.extraFields.some((field) => field.id === 0x7075)
            || offset < 0 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new IntakeFailure('ZIP_NAME_MISMATCH');
          const localNameLength = bytes.readUInt16LE(offset + 26);
          if (offset + 30 + localNameLength > bytes.length
            || !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(Buffer.from(name, 'ascii'))
            || bytes.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag
            || bytes.readUInt16LE(offset + 8) !== entry.compressionMethod) throw new IntakeFailure('ZIP_NAME_MISMATCH');
          paths.add(name);
          if (entry.isEncrypted() || /vbaproject|externallinks|\.bin$/iu.test(name)) {
            throw new IntakeFailure('ACTIVE_CONTENT');
          }
          if (entry.uncompressedSize > P.expandedBytes - expandedBytes) throw new IntakeFailure('EXPANDED_LIMIT');
          const media = name.startsWith('xl/media/') && !name.endsWith('/');
          if (media && (++mediaCount > P.mediaCount || entry.uncompressedSize > P.oneMediaBytes)) {
            throw new IntakeFailure('MEDIA_LIMIT');
          }
          if (name.endsWith('/')) return;
          const xml = /\.(xml|rels)$/u.test(name) ? new SaxesParser({ xmlns: false }) : undefined;
          let textLength = 0;
          let contentContainer: string | undefined, contentLength = 0;
          let currentRow: number | undefined;
          const seenRows = new Set<number>(), seenCells = new Set<string>();
          xml?.on('doctype', () => { throw new IntakeFailure('ACTIVE_CONTENT'); });
          xml?.on('opentag', (tag) => {
            const local = tag.name.split(':').at(-1);
            if (local === 'Relationship') {
              const mode = tag.attributes.TargetMode, target = String(tag.attributes.Target ?? '');
              if ((mode !== undefined && mode !== 'Internal') || /^(?:[a-z][a-z0-9+.-]*:|[/\\])/iu.test(target)) throw new IntakeFailure('EXTERNAL_RESOURCE');
              if (name === 'xl/_rels/workbook.xml.rels') relations.set(String(tag.attributes.Id), target);
            }
            if (name === 'xl/workbook.xml' && local === 'sheet') sheets.set(String(tag.attributes.name), String(tag.attributes['r:id']));
            if (local === 'Override' && String(tag.attributes.ContentType).toLowerCase().includes('macroenabled')) throw new IntakeFailure('ACTIVE_CONTENT');
            if (name.startsWith('xl/worksheets/')) {
              if (local === 'col') {
                const min = Number(tag.attributes.min), max = Number(tag.attributes.max);
                if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > P.columns) throw new IntakeFailure('COORDINATE_LIMIT');
              }
              if (local === 'row') {
                const row = Number(tag.attributes.r);
                if (!/^[1-9][0-9]*$/u.test(String(tag.attributes.r)) || row > P.rows + 1) throw new IntakeFailure('COORDINATE_LIMIT');
                if (currentRow !== undefined || seenRows.has(row)) throw new IntakeFailure('AMBIGUOUS_COORDINATE');
                currentRow = row; seenRows.add(row); seenCells.clear();
              }
              if (local === 'c') {
                const ref = String(tag.attributes.r);
                if (coordinate(ref) !== currentRow || seenCells.has(ref)) throw new IntakeFailure('AMBIGUOUS_COORDINATE');
                seenCells.add(ref);
                if (++cells > P.cells) throw new IntakeFailure('CELL_LIMIT');
              }
              if (['drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls'].includes(local ?? '')) resources.add(name);
              if (local === 'dimension' || local === 'mergeCell') {
                for (const part of String(tag.attributes.ref).split(':')) coordinate(part);
              }
            }
            if (local === 'si' && ++strings > P.sharedStrings) throw new IntakeFailure('STRING_LIMIT');
            if ((local === 'c' && name.startsWith('xl/worksheets/')) || (local === 'si' && name === 'xl/sharedStrings.xml')) {
              if (contentContainer !== undefined) throw new IntakeFailure('INVALID_ZIP_XML');
              contentContainer = local; contentLength = 0;
            }
            if (local === 't' || local === 'v') textLength = 0;
          });
          xml?.on('closetag', (tag) => {
            const local = tag.name.split(':').at(-1);
            if (local === 'row') currentRow = undefined;
            if (local === contentContainer) contentContainer = undefined;
          });
          const inspectText = (text: string) => {
            textLength += text.length;
            if (contentContainer !== undefined) contentLength += text.length;
            if (textLength > P.cellChars || contentLength > P.cellChars) throw new IntakeFailure('CELL_TEXT_LIMIT');
          };
          xml?.on('text', inspectText); xml?.on('cdata', inspectText);
          const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, value) => error || !value ? rejectStream(error) : resolveStream(value));
          });
          const decoder = new StringDecoder('utf8');
          let actual = 0;
          for await (const chunk of stream) {
            const buffer = chunk as Buffer;
            actual += buffer.length; expandedBytes += buffer.length;
            if (expandedBytes > P.expandedBytes) throw new IntakeFailure('EXPANDED_LIMIT');
            if (media) {
              mediaBytes += buffer.length;
              if (actual > P.oneMediaBytes || mediaBytes > P.mediaBytes) throw new IntakeFailure('MEDIA_LIMIT');
            }
            xml?.write(decoder.write(buffer));
          }
          xml?.write(decoder.end()).close();
          if (actual !== entry.uncompressedSize) throw new IntakeFailure('ZIP_SIZE_MISMATCH');
        };
        void inspect().then(() => { if (!settled) zip.readEntry(); }, fail);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
