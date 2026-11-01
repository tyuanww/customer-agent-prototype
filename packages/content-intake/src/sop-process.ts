import { createHash } from 'node:crypto';
import { INTAKE_POLICY as P, FAQ_HEADERS, isParseResult, type ParseResult } from './policy.js';
import { SOP_SHEET_NAMES, type tryParseSopAsFaq } from './sop.js';

export type SopData = NonNullable<Awaited<ReturnType<typeof tryParseSopAsFaq>>>;
export type SopScope = Readonly<{ sourceId: string; brandId: string; shopId: string | null }>;
export type SopOutcome = { kind: 'not-sop' } | { kind: 'parsed'; value: SopData };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number = P.cellChars): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function references(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= P.columns && value.every(item => text(item, 128)) ? value : null;
}

/** SOP may join several valid cells into one answer, so its answer limit is not
 * the FAQ single-cell limit. The aggregate still comes from the archive policy. */
function isSopParseResult(value: unknown): value is ParseResult {
  if (!object(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) return isParseResult(value, P.version);
  if (value.policyVersion !== P.version || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > P.cells
    || !Array.isArray(value.questions) || value.questions.length || !Array.isArray(value.issues) || value.issues.length
    || !Array.isArray(value.excluded) || value.excluded.length || !count(value.expandedBytes, 0, P.expandedBytes)
    || !count(value.mediaCount, 0, P.cells)) return false;
  let total = 0;
  for (const row of value.rows) {
    if (!object(row) || !text(row.id, 128) || !text(row.title) || !text(row.body, P.normalizedTextChars + P.columns)
      || row.state !== '启用' || !Array.isArray(row.values) || row.values.length !== FAQ_HEADERS.length
      || !row.values.every((item: unknown) => text(item, P.normalizedTextChars + P.columns))
      || row.values[0] !== row.id || row.values[1] !== row.title || row.values[2] !== row.body) return false;
    total += row.body.length;
    if (total > P.normalizedTextChars + P.cells) return false;
  }
  return true;
}

export function encodeSopOutcome(value: SopData | null): unknown {
  if (value === null) return { kind: 'not-sop' };
  const assets = new Map<string, { bytes: Buffer; mime: string }>();
  const previews = value.previews.map(({ bytes, ...preview }) => {
    const id = digest(bytes), previous = assets.get(id);
    if (previous && (!previous.bytes.equals(bytes) || previous.mime !== preview.mime)) throw new Error('MEDIA_DIGEST_CONFLICT');
    if (!previous) assets.set(id, { bytes, mime: preview.mime });
    return { ...preview, assetId: id };
  });
  const rowBindings = value.rowBindings.map((binding, index) => {
    const row = value.parsed.rows[index];
    if (!row || row.id !== binding.businessEntryId || row.title !== binding.title || row.body !== binding.answerText) {
      throw new Error('SOP_BINDING_MISMATCH');
    }
    return { rowId: binding.rowId };
  });
  return { kind: 'parsed', value: { contentVersion: value.contentVersion, parsed: value.parsed, rowBindings, previews,
    assets: [...assets].map(([sha256, asset]) => ({ sha256, mime: asset.mime, bytesBase64: asset.bytes.toString('base64') })) } };
}

/** The child response cannot grant access or introduce unbounded rows or media. */
export function decodeSopOutcome(input: unknown): SopOutcome | null {
  if (!object(input)) return null;
  if (input.kind === 'not-sop') return { kind: 'not-sop' };
  if (input.kind !== 'parsed' || !object(input.value)) return null;
  const value = input.value;
  if (!object(value.contentVersion) || (value.contentVersion.kind !== 'declared' && value.contentVersion.kind !== 'sha256')
    || !text(value.contentVersion.value) || !value.contentVersion.value
    || (value.contentVersion.kind === 'sha256' && !/^[0-9a-f]{64}$/u.test(value.contentVersion.value))
    || !isSopParseResult(value.parsed) || !Array.isArray(value.rowBindings) || !Array.isArray(value.previews)
    || !Array.isArray(value.assets) || value.assets.length > P.mediaCount || value.previews.length > P.cells
    || value.rowBindings.length !== value.parsed.rows.length
    || (value.parsed.ok && value.previews.length !== value.parsed.mediaCount)
    || (!value.parsed.ok && (value.rowBindings.length !== 0 || value.previews.length !== 0 || value.assets.length !== 0))) return null;
  const rowBindings: SopData['rowBindings'][number][] = [], rowIds = new Set<string>();
  for (const [index, item] of value.rowBindings.entries()) {
    const row = value.parsed.rows[index];
    if (!object(item) || !row || !text(item.rowId, 256) || rowIds.has(item.rowId)) return null;
    const rowId = item.rowId;
    if (!SOP_SHEET_NAMES.some(sheet => {
      if (row.title !== sheet) return false;
      const prefix = `sop:${sheet}:`;
      const number = rowId.startsWith(prefix) ? Number(rowId.slice(prefix.length)) : 0;
      return Number.isSafeInteger(number) && number >= 1 && number <= P.rows + 1 && rowId === `${prefix}${number}`;
    })) return null;
    rowBindings.push({ rowId, businessEntryId: row.id, title: row.title, answerText: row.body });
    rowIds.add(rowId);
  }
  const assets = new Map<string, { bytes: Buffer; mime: SopData['previews'][number]['mime'] }>();
  let totalBytes = 0;
  for (const item of value.assets) {
    if (!object(item) || !text(item.sha256, 64) || !/^[0-9a-f]{64}$/u.test(item.sha256) || assets.has(item.sha256)
      || (item.mime !== 'image/png' && item.mime !== 'image/jpeg')
      || typeof item.bytesBase64 !== 'string' || item.bytesBase64.length > Math.ceil(P.oneMediaBytes / 3) * 4) return null;
    const bytes = Buffer.from(item.bytesBase64, 'base64');
    totalBytes += bytes.length;
    if (!bytes.length || bytes.length > P.oneMediaBytes || totalBytes > P.mediaBytes
      || bytes.toString('base64') !== item.bytesBase64 || digest(bytes) !== item.sha256) return null;
    assets.set(item.sha256, { bytes, mime: item.mime });
  }
  const previews: SopData['previews'][number][] = [];
  const ordinals = new Map<string, number>(), used = new Set<string>();
  for (const item of value.previews) {
    if (!object(item) || !text(item.sheet) || !SOP_SHEET_NAMES.some(sheet => sheet === item.sheet)
      || !count(item.row, 1, P.rows + 1) || !count(item.column, 1, P.columns) || !count(item.ordinal, 1, P.mediaCount)
      || !text(item.rowId, 256) || item.rowId !== `sop:${item.sheet}:${item.row}` || !rowIds.has(item.rowId)
      || item.ordinal !== (ordinals.get(item.rowId) ?? 0) + 1 || !text(item.familySourceId, 128)
      || (item.mime !== 'image/png' && item.mime !== 'image/jpeg')
      || !text(item.assetId, 64)) return null;
    const asset = assets.get(item.assetId), productRefIds = references(item.productRefIds), scenarioRefIds = references(item.scenarioRefIds);
    if (!asset || asset.mime !== item.mime || !productRefIds || !scenarioRefIds) return null;
    previews.push({ bytes: asset.bytes, mime: item.mime, rowId: item.rowId, sheet: item.sheet, row: item.row, column: item.column,
      ordinal: item.ordinal, productRefIds, scenarioRefIds, familySourceId: item.familySourceId });
    ordinals.set(item.rowId, item.ordinal); used.add(item.assetId);
  }
  if (used.size !== assets.size) return null;
  const kind = value.contentVersion.kind;
  if (kind !== 'declared' && kind !== 'sha256') return null;
  return { kind: 'parsed', value: { contentVersion: { kind, value: value.contentVersion.value }, parsed: value.parsed, rowBindings, previews } };
}
