import { type components } from '@customer-agent/contracts';
import type { ParseResult } from '@customer-agent/content-intake';
import type { Source } from './authority.js';
import { readCandidate, materialFor, type Job } from './candidate.js';
import { canonical, digest } from './material.js';
import { sopSqlFailure } from './sop-media.js';
import { IntakeRejection, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
export type RowBinding = { rowId: string; businessEntryId: string; title: string; answerText: string };
export type MediaItem = { mediaObjectId: string; payloadObjectId: string; sha256: string; bytes: number; mime: string;
  sheetName: string; rowNumber: number; columnNumber: number; ordinal: number };

/** Published rows and images of this exact source, read through the job rather
 * than from caller input. A new workbook may omit a row whose answer did not
 * change, and `freeze_sop_parsed_candidate` accepts that only when the row and
 * its images are carried over unchanged. */
export type SopInheritedAssets = { rows: RowBinding[]; media: MediaItem[] };

const row = (value: unknown): RowBinding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  const item = value as Record<string, unknown>;
  if (typeof item.rowId !== 'string' || !/^sop:[^:]{1,128}:[1-9][0-9]{0,3}$/.test(item.rowId)
    || typeof item.businessEntryId !== 'string' || typeof item.title !== 'string' || typeof item.answerText !== 'string') {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { rowId: item.rowId, businessEntryId: item.businessEntryId, title: item.title, answerText: item.answerText };
};

const media = (value: unknown): MediaItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  const item = value as Record<string, unknown>;
  if (typeof item.mediaObjectId !== 'string' || !/^med_[0-9a-f]{64}$/.test(item.mediaObjectId)
    || typeof item.payloadObjectId !== 'string' || !/^obj_[0-9a-f]{64}$/.test(item.payloadObjectId)
    || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)
    || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > 5 * 1024 * 1024
    || !['image/png', 'image/jpeg', 'image/gif'].includes(String(item.mime))
    || typeof item.sheetName !== 'string' || !Number.isInteger(item.rowNumber) || Number(item.rowNumber) < 1
    || !Number.isInteger(item.columnNumber) || Number(item.columnNumber) < 1 || Number(item.columnNumber) > 32
    || !Number.isInteger(item.ordinal) || Number(item.ordinal) < 1 || Number(item.ordinal) > 100) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { mediaObjectId: item.mediaObjectId, payloadObjectId: item.payloadObjectId, sha256: item.sha256,
    bytes: Number(item.bytes), mime: String(item.mime), sheetName: item.sheetName, rowNumber: Number(item.rowNumber),
    columnNumber: Number(item.columnNumber), ordinal: Number(item.ordinal) };
};

const array = (value: unknown): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  return value;
};

export async function readSopInheritedAssets(client: IntakeTransaction, actor: Principal, jobId: string): Promise<SopInheritedAssets> {
  const result = await client.query<{ value: { rows?: unknown; media?: unknown } }>(
    'SELECT content_intake.read_sop_inherited_assets($1,$2) AS value', [actor.id, jobId]).catch(sopSqlFailure);
  const value = result.rows[0]?.value;
  if (!value || typeof value !== 'object') throw new IntakeRejection('MATERIAL_CHANGED', 'CONFLICT');
  return { rows: array(value.rows).map(row), media: array(value.media).map(media) };
}

/** The only SOP freeze path. `freeze_sop_parsed_candidate` writes the candidate,
 * its workbook row mapping, its media and its asset registration in one
 * transaction; the generic freeze cannot, and publishing refuses a candidate
 * without those rows (0040 project_sop_release_media). */
export async function freezeSopParsed(client: IntakeTransaction, actor: Principal, job: Job, src: Source,
  parsed: ParseResult, contentVersion: { kind: 'declared' | 'sha256'; value: string },
  rowBindings: readonly RowBinding[], assets: SopInheritedAssets,
  freshMedia: readonly MediaItem[]): Promise<C['IntakeCandidate']> {
  if (job.state !== 'parsing' || job.actor_id !== actor.id) throw new IntakeRejection('MATERIAL_CHANGED');
  if (src.mode !== 'v2-preview' || src.version !== Number(job.source_version)) throw new IntakeRejection('SOURCE_MISMATCH');
  const material = await materialFor(client, job, src, parsed);
  const fresh = new Set(rowBindings.map(item => item.rowId));
  // SQL returns every published row of this source, not only the omitted ones.
  // A published entry the workbook still contains is fresh, carrying whatever
  // text the operator now wrote; only an entry the workbook no longer mentions
  // is inherited unchanged. Identity here is the code, never the row.
  const currentCodes = new Set(rowBindings.map(item => item.businessEntryId));
  const inherited = assets.rows.filter(item => !currentCodes.has(item.businessEntryId));
  const inheritedRowIds = new Set(inherited.map(item => item.rowId));
  assertNoRowIdCollision(rowBindings, inherited);
  const inheritedMedia = assets.media.filter(item => inheritedRowIds.has(`sop:${item.sheetName}:${item.rowNumber}`));
  const rows = [...rowBindings, ...inherited];
  // SQL accepts rows only when they are exactly the material entries; a parser
  // that omits or invents one is refused here, not silently repaired.
  if (rows.length !== material.entries.length) throw new IntakeRejection('MATERIAL_CHANGED');
  const pMedia = {
    sourceId: src.scope.sourceId, sourceVersion: src.version, fileSha256: material.object.sha256,
    materialDigest: digest(canonical(material)), contentVersion,
    freshRowIds: [...fresh], items: [...freshMedia, ...inheritedMedia],
  };
  const result = await client.query<{ value: { candidateId: string; version: number; validUntil: string } }>(
    'SELECT content_intake.freeze_sop_parsed_candidate($1,$2,$3,$4,$5) AS value',
    [actor.id, job.job_id, JSON.stringify(material), JSON.stringify(rows), JSON.stringify(pMedia)]).catch(sopSqlFailure);
  const frozen = result.rows[0]!.value;
  client.validUntil(Date.parse(frozen.validUntil));
  const candidate = await readCandidate(client, actor, frozen.candidateId, frozen.version, 'import');
  if (candidate.key.digest !== digest(canonical(material))) throw new IntakeRejection('MATERIAL_CHANGED');
  return candidate;
}

/** A SOP row's identity is the operator's code, so moving a workbook row is legal and
 * an edit is an ordinary material difference. What is not legal is two entries
 * claiming one physical row: `sop_candidate_rows` is keyed on
 * (candidate_id, candidate_version, row_id), so an inherited published row and a
 * fresh row at the same sheet position would collide on that key and surface as a
 * raw 23505 instead of a rejection. */
export function assertNoRowIdCollision(parsed: readonly RowBinding[], inherited: readonly RowBinding[]): void {
  const claimed = new Set(parsed.map(row => row.rowId));
  if (inherited.some(row => claimed.has(row.rowId))) throw new IntakeRejection('MATERIAL_CHANGED');
}

/** The workbook's own version column wins; without one the parser falls back to
 * the file digest. SQL pins this to every deletion fact for the source. */
export function sopContentVersion(value: unknown): { kind: 'declared' | 'sha256'; value: string } {
  const raw = value as { kind?: unknown; value?: unknown } | null | undefined;
  if (!raw || (raw.kind !== 'declared' && raw.kind !== 'sha256') || typeof raw.value !== 'string'
    || raw.value.length < 1 || raw.value.length > 32767 || !raw.value.trim()) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { kind: raw.kind, value: raw.value };
}
