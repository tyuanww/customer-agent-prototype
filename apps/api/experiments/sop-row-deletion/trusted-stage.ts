import { tryParseSopAsFaq } from '@customer-agent/content-intake';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../../src/auth-service.js';
import type { ContentObjectStore, ContentAttachmentStore } from '../../src/content-object-store.js';
import { authorize } from '../../src/content-intake/authority.js';
import { getJob, readCandidate } from '../../src/content-intake/candidate.js';
import { listPreviews, mediaObjectId, previewFromBytes, stagePreviews } from '../../src/content-intake/linked-preview.js';
import { canonical, digest, materialFromParse } from '../../src/content-intake/material.js';
import { attachmentDescriptor, createSopMediaLifecycle, decodeSopMediaReservation, sopSqlFailure as sqlFailure } from './media-lifecycle.js';
import { clock, createIntakeTransactions, IntakeRejection, type IntakePool } from '../../src/content-intake/transaction.js';

type Candidate = components['schemas']['IntakeCandidate'];
type Parsed = NonNullable<Awaited<ReturnType<typeof tryParseSopAsFaq>>>;
type Media = { payloadObjectId: string; mediaObjectId: string; sha256: string; bytes: number; mime: string; sheetName: string; rowNumber: number; columnNumber: number; ordinal: number };
type Assets = { rows: Parsed['rowBindings']; media: Media[]; frozenMedia: Media[]; pendingPayloads: unknown[] };
const assetIdentity = ({ rows, media, frozenMedia }: Assets) => canonical({ rows, media, frozenMedia });

/** Closed experiment producer: derives every row and attachment from the adopted
 * input object. No caller-supplied row mappings or media metadata enter this API.
 * Freeze and asset registration share the existing transaction and content lock.
 * A candidate SQL capability owns all writes; the business role receives no DML.
 * The parser process is trusted to derive rows from object bytes; SQL rechecks the
 * persisted job, object, source, scope, material and exact row/media relationships. */
export function createTrustedSopStage(pool: IntakePool, store: Pick<ContentObjectStore, 'readPayload'> & Partial<ContentAttachmentStore>,
  requireProductSession = true, report?: (id: string, error: unknown) => void) {
  const run = createIntakeTransactions(pool, report, { requireProductSession });
  const diagnose = (id: string, error: unknown) => {
    try { report?.(id, error); } catch { /* Diagnostics cannot change commit certainty. */ }
  };
  return async (actor: AuthenticatedUser, jobId: string) => {
    const prepared = await run(actor, 'sop-stage-prepare', null, null, async (client, who) => {
      const { job, src } = await getJob(client, who, parseContractSchema('IntakeId', jobId));
      if (job.actor_id !== who.id || !['reading', 'parsing', 'validated'].includes(job.state)) throw new IntakeRejection('MATERIAL_CHANGED');
      const object = (await client.query<{ sha256: string; bytes: string }>(
        "SELECT sha256,bytes FROM content_intake.objects WHERE object_id=$1 AND source_id=$2 AND actor_id=$3 AND purpose='input'",
        [job.object_id, job.source_id, who.id])).rows[0];
      if (!object) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      if (src.mode !== 'v2-preview' || src.version !== Number(job.source_version)) throw new IntakeRejection('SOURCE_MISMATCH');
      const assets = (await client.query<{ value: Assets }>(
        'SELECT content_intake.read_sop_inherited_assets($1,$2) AS value', [who.id, jobId]).catch(sqlFailure)).rows[0]!.value;
      return { job, src, object, assets };
    }, value => value as { job: Awaited<ReturnType<typeof getJob>>['job']; src: Awaited<ReturnType<typeof getJob>>['src']; object: { sha256: string; bytes: string }; assets: Assets });
    if (!prepared.ok) return prepared;
    const { job, src, object, assets } = prepared.value;
    if (!store.withObjectLock || !store.readAttachment || !store.persistAttachment) {
      return { ok: false as const, code: 'VALIDATION' as const, reason: 'FILE_INVALID' as const,
        commit: 'rolled_back' as const, diagnosticId: 'sop-media-store-unavailable' };
    }
    const durable = store as ContentAttachmentStore;
    const lifecycle = createSopMediaLifecycle(run, durable);
    let parsed: Parsed;
    try {
      const bytes = await store.readPayload(job.object_id);
      if (bytes.length !== Number(object.bytes) || digest(bytes) !== object.sha256) throw new Error('OBJECT_CHANGED');
      const result = await tryParseSopAsFaq(bytes, src.scope);
      if (!result?.parsed.ok) throw new Error('INVALID_SOP');
      parsed = result;
    } catch {
      return { ok: false as const, code: 'VALIDATION' as const, reason: 'FILE_INVALID' as const,
        commit: 'rolled_back' as const, diagnosticId: 'sop-stage-input' };
    }
    const persisted = new Map<string, Awaited<ReturnType<typeof lifecycle.persist>> & { ok: true }>();
    for (const raw of assets.pendingPayloads) {
      const reservation = decodeSopMediaReservation(raw);
      persisted.set(reservation.mediaObjectId, { ok: true, value: reservation });
    }
    const releaseUnused = async () => {
      for (const result of persisted.values()) {
        try {
          const released = await lifecycle.release(actor, jobId, result.value);
          if (!released.ok) diagnose('sop-media-release', released);
        } catch (error) { diagnose('sop-media-release', error); }
      }
    };
    try {
      for (const item of job.state === 'validated' ? [] : parsed.previews) {
        const id = mediaObjectId(src.scope.sourceId, item.bytes);
        if (persisted.has(id)) continue;
        const result = await lifecycle.persist(actor, jobId, src.scope.sourceId, item.bytes, item.mime);
        if (!result.ok) {
          if (result.commit === 'rolled_back') await releaseUnused();
          return result;
        }
        persisted.set(id, result);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'CONTENT_OBJECT_BUSY') {
        diagnose('sop-media-busy', error);
        return { ok: false as const, code: 'OVERLOADED' as const, reason: 'QUOTA_EXCEEDED' as const,
          commit: 'rolled_back' as const, diagnosticId: 'sop-media-busy' };
      }
      await releaseUnused();
      diagnose('sop-media-persist', error);
      return { ok: false as const, code: 'VALIDATION' as const, reason: 'FILE_INVALID' as const,
        commit: 'rolled_back' as const, diagnosticId: 'sop-media-persist' };
    }
    let retainedPreviews: ReturnType<typeof listPreviews> = [];
    let rowBindings: Parsed['rowBindings'];
    let mediaItems: Media[];
    // Snapshot metadata is read under authority, bytes outside the content lock.
    // The final transaction compares the same metadata and rechecks authority.
    try {
      const currentIds = new Set(parsed.rowBindings.map(row => row.businessEntryId));
      const inheritedRows = assets.rows.filter(row => !currentIds.has(row.businessEntryId));
      const inheritedIds = new Set(inheritedRows.map(row => row.rowId));
      rowBindings = [...parsed.rowBindings, ...inheritedRows];
      const inheritedMedia = assets.media.filter(item => inheritedIds.has(`sop:${item.sheetName}:${item.rowNumber}`));
      const retained = listPreviews(job.base_release_id ?? '', new Set([src.scope.sourceId]));
      for (const item of inheritedMedia) {
        // Durable payloads, not the optional warm Map, are the byte authority.
        // Validate one image at a time; the query reader also opens only one.
        await durable.readAttachment(attachmentDescriptor({ ...item, objectId: item.payloadObjectId,
          mime: item.mime as 'image/png' | 'image/jpeg' | 'image/gif' }));
        const known = retained.find(preview => preview.objectId === item.mediaObjectId && preview.rowId === `sop:${item.sheetName}:${item.rowNumber}`
          && preview.sha256 === item.sha256 && preview.mime === item.mime && preview.bytes.length === item.bytes && digest(preview.bytes) === item.sha256);
        if (known) retainedPreviews = [...retainedPreviews, known];
      }
      const freshMedia: Media[] = [];
      for (const item of parsed.previews) {
        const id = mediaObjectId(src.scope.sourceId, item.bytes);
        let payloadObjectId: string;
        if (job.state === 'validated') {
          // Recover the exact frozen relationship, never the original redundant
          // reservation (which may have been released after canonical dedup).
          const saved = assets.frozenMedia.find(media => media.mediaObjectId === id && media.sha256 === digest(item.bytes)
            && media.bytes === item.bytes.length && media.mime === item.mime && media.sheetName === item.sheet
            && media.rowNumber === item.row && media.columnNumber === item.column && media.ordinal === item.ordinal);
          if (!saved) throw new IntakeRejection('MATERIAL_CHANGED');
          await durable.readAttachment(attachmentDescriptor({ ...saved, objectId: saved.payloadObjectId,
            mime: saved.mime as 'image/png' | 'image/jpeg' | 'image/gif' }));
          payloadObjectId = saved.payloadObjectId;
        } else {
          const saved = persisted.get(id);
          if (!saved) throw new IntakeRejection('MATERIAL_CHANGED');
          payloadObjectId = saved.value.objectId;
        }
        freshMedia.push({ mediaObjectId: id, sha256: digest(item.bytes), bytes: item.bytes.length, mime: item.mime,
          payloadObjectId, sheetName: item.sheet, rowNumber: item.row, columnNumber: item.column, ordinal: item.ordinal });
      }
      mediaItems = [...freshMedia, ...inheritedMedia];
    } catch (error) {
      await releaseUnused(); diagnose('sop-media-read', error);
      return { ok: false as const, code: error instanceof IntakeRejection ? error.code : 'VALIDATION' as const,
        reason: error instanceof IntakeRejection ? error.reason : 'FILE_INVALID' as const,
        commit: 'rolled_back' as const, diagnosticId: 'sop-media-read' };
    }
    let previewStage: ReturnType<typeof stagePreviews> | undefined;
    const frozen = await run(actor, 'sop-stage-freeze', null, null, async (client, who) => {
      const fresh = await getJob(client, who, jobId);
      if (fresh.job.actor_id !== who.id || fresh.job.object_id !== job.object_id || fresh.src.version !== src.version) throw new IntakeRejection('MATERIAL_CHANGED');
      let material: components['schemas']['IntakeMaterial'];
      if (fresh.job.state === 'validated') {
        material = parseContractSchema('IntakeMaterial', (await client.query<{ material: unknown }>(
          'SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2',
          [fresh.job.result_candidate_id, fresh.job.result_candidate_version])).rows[0]?.material);
      } else {
        if (!['reading', 'parsing'].includes(fresh.job.state)) throw new IntakeRejection('MATERIAL_CHANGED');
        const previous = await client.query<{ entry: unknown }>(`SELECT e AS entry FROM content_intake.release_lineage l
          JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
          CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
          WHERE l.release_id=$1 AND l.source_id=$2 AND e->>'businessEntryId'=l.business_entry_id`, [fresh.job.base_release_id, fresh.job.source_id]);
        const terms = await client.query<{ id: string; kind: 'product' | 'scenario'; display_version: string }>(`SELECT v.vocabulary_id AS id,v.kind,max(d.display_version) AS display_version
          FROM content_intake.vocabulary v JOIN content_intake.vocabulary_displays d USING(vocabulary_id)
          JOIN content_intake.scopes s USING(scope_id) WHERE v.active AND s.tenant_id=$1 AND s.app_id=$2 AND s.brand_id=$3
            AND s.domain=$4 AND (s.shop_id IS NULL OR s.shop_id IS NOT DISTINCT FROM $5) GROUP BY v.vocabulary_id,v.kind`,
        [src.scope.tenantId, src.scope.appId, src.scope.brandId, src.scope.domain, src.scope.shopId]);
        const recent = await client.query<{ count: string }>(`SELECT coalesce(sum(c.explicit_disable_count),0) AS count
          FROM content_intake.publications p JOIN content_intake.candidate_versions c ON c.candidate_id=p.candidate_id AND c.version=p.candidate_version
          JOIN public.content_releases r ON r.release_id=p.release_id WHERE c.source_id=$1
            AND r.published_at>clock_timestamp()-interval '24 hours' AND r.published_at<=clock_timestamp()`, [job.source_id]);
        material = materialFromParse({ parsed: parsed.parsed, source: fresh.src,
          object: parseContractSchema('IntakeObject', { objectId: job.object_id, sourceId: job.source_id, sha256: object.sha256,
            bytes: Number(object.bytes), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          contributors: fresh.job.contributor_ids, previous: previous.rows.map(row => parseContractSchema('IntakeEntry', row.entry)),
          terms: terms.rows.map(term => ({ ...term, displayVersion: Number(term.display_version) })),
          baseReleaseId: fresh.job.base_release_id, now: await clock(client), recentDisables: Number(recent.rows[0]!.count) });
      }
      const prior = (await client.query<{ value: Assets }>(
        'SELECT content_intake.read_sop_inherited_assets($1,$2) AS value', [who.id, jobId]).catch(sqlFailure)).rows[0]!.value;
      if ((fresh.job.state === 'validated') !== (job.state === 'validated')
        || assetIdentity(prior) !== assetIdentity(assets)) throw new IntakeRejection('MATERIAL_CHANGED');
      let candidate: Candidate;
      try {
        const result = (await client.query<{ value: { candidateId: string; version: number; validUntil: string } }>(
          'SELECT content_intake.freeze_sop_parsed_candidate($1,$2,$3,$4,$5) AS value', [who.id, jobId,
            JSON.stringify(material), JSON.stringify(rowBindings), JSON.stringify({
              sourceId: src.scope.sourceId, sourceVersion: src.version, fileSha256: object.sha256, materialDigest: digest(canonical(material)), freshRowIds: parsed.rowBindings.map(row => row.rowId), contentVersion: parsed.contentVersion, items: mediaItems,
            })])).rows[0]!.value;
        client.validUntil(Date.parse(result.validUntil));
        candidate = await readCandidate(client, who, result.candidateId, result.version, 'import');
      } catch (error) { sqlFailure(error); }
      const staged = [...parsed.previews.map(item => previewFromBytes(item.bytes, item.mime, src.scope.sourceId, item.rowId, item)), ...retainedPreviews];
      // Publish immutable input bytes before COMMIT: a later committed deletion
      // may project its surviving rows before this freeze caller resumes.
      previewStage = stagePreviews(job.object_id, staged);
      client.beforeCommit(async () => { await authorize(client, who, 'import', fresh.src); });
      return candidate;
    }, value => parseContractSchema('IntakeCandidate', value));
    if (frozen.ok) {
      previewStage?.commit(frozen.value.key.candidateId, frozen.value.key.version);
    }
    if (!frozen.ok && frozen.commit === 'rolled_back') previewStage?.rollback();
    // SQL refuses to release adopted/referenced payloads. This reclaims only
    // confirmed redundant or rolled-back private reservations, never unknowns.
    if (frozen.ok || frozen.commit === 'rolled_back') await releaseUnused();
    return frozen;
  };
}
