import { parseContractSchema, type components } from '@customer-agent/contracts/sop-unified';
import { parsePublishedIntakeRisk } from './content-intake/contract-view.js';
import type { AuthenticatedUser } from './auth-service.js';
import { canonical, digest } from './content-intake/material.js';
import { IntakeRejection, type createIntakeTransactions } from './content-intake/transaction.js';
import type { SopEntryPermission, UnifiedSopQueryRequest } from './sop-unified-query-model.js';

type PermissionFact = Omit<SopEntryPermission, 'risk_level' | 'copy_allowed'> & {
  risk_level: SopEntryPermission['risk_level'] | 'unclassified';
  copy_allowed: boolean | null;
};
export type SopQueryFactDocument = {
  candidateId: string;
  candidateVersion: number;
  sourceId: string;
  flowId: string;
  graphDigest: string;
  sopGroup: UnifiedSopQueryRequest['sop_group'];
  permissions: PermissionFact[];
};
export type RegisteredSyntheticSopFacts = {
  ref: string;
  version: string;
  bytes: Buffer;
};
export type SopQueryPublicationFacts = {
  publicationReleaseId: string;
  materialDigest: string;
  sourceVersion: number;
  mappingDigest: string;
  mappingSha256: string;
  sourceClaim: components['schemas']['IntakeSourceClaim'];
  risk: ReturnType<typeof parsePublishedIntakeRisk>;
  confirmation: {
    evidenceVersion: number;
    versionKind: 'integer' | 'opaque';
    versionValue: string;
    acquisition: 'feishu-export' | 'controlled-synthetic-export';
    objectSha256: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return value;
}

/** This private projection comes from the original publication's immutable
 * candidate, mapping version and confirmation. It grants no entry permission. */
export function parseSopQueryPublicationFacts(raw: unknown): SopQueryPublicationFacts {
  const value = object(raw, ['publicationReleaseId', 'materialDigest', 'sourceVersion', 'mappingDigest',
    'mappingSha256', 'sourceClaim', 'risk', 'confirmation']);
  const confirmation = object(value.confirmation, ['evidenceVersion', 'versionKind', 'versionValue', 'acquisition', 'objectSha256']);
  const sourceClaim = parseContractSchema('IntakeSourceClaim', value.sourceClaim);
  if (confirmation.versionKind !== 'integer' && confirmation.versionKind !== 'opaque') throw new IntakeRejection('SOURCE_MISMATCH');
  if (confirmation.acquisition !== sourceClaim.acquisition || confirmation.objectSha256 !== sourceClaim.fileSha256) {
    throw new IntakeRejection('SOURCE_MISMATCH');
  }
  const versionValue = text(confirmation.versionValue, 128);
  if (confirmation.versionKind === 'integer' && !/^(0|[1-9][0-9]{0,18})$/u.test(versionValue)) throw new IntakeRejection('SOURCE_ORDER_UNKNOWN');
  return {
    publicationReleaseId: text(value.publicationReleaseId, 256),
    materialDigest: parseContractSchema('IntakeSopHash', value.materialDigest),
    sourceVersion: parseContractSchema('IntakeVersion', value.sourceVersion),
    mappingDigest: parseContractSchema('IntakeSopHash', value.mappingDigest),
    mappingSha256: parseContractSchema('IntakeSopHash', value.mappingSha256), sourceClaim,
    risk: parsePublishedIntakeRisk(value.risk),
    confirmation: { evidenceVersion: parseContractSchema('IntakeVersion', confirmation.evidenceVersion),
      versionKind: confirmation.versionKind, versionValue, acquisition: sourceClaim.acquisition,
      objectSha256: parseContractSchema('IntakeSopHash', confirmation.objectSha256) },
  };
}

/** Registration consumes exact bytes of an explicitly synthetic source version.
 * The source digest binds those bytes, including unknown-risk declarations. */
export function parseSyntheticSopQueryFacts(source: RegisteredSyntheticSopFacts) {
  if (!/^synthetic:[A-Za-z0-9._:-]+$/.test(source.ref) || !/^[A-Za-z0-9._:-]+$/.test(source.version) || source.bytes.length > 1_048_576
    || !source.bytes.equals(Buffer.from(source.bytes.toString('utf8'), 'utf8'))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const sourceRef = text(source.ref, 512), sourceVersion = text(source.version, 128);
  let raw: unknown;
  try { raw = JSON.parse(source.bytes.toString('utf8')); }
  catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
  const value = object(raw, ['candidateId', 'candidateVersion', 'sourceId', 'flowId', 'graphDigest', 'sopGroup', 'permissions']);
  const group = parseContractSchema('MenokinSopQuerySopQueryRequest', {
    sop_group: value.sopGroup, shop_id: 'synthetic-registration', query_text: 'synthetic',
    context_generation: 'synthetic', request_id: '00000000-0000-4000-8000-000000000001',
  }).sop_group;
  if (!Array.isArray(value.permissions) || value.permissions.length > 4096) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  const permissions = value.permissions.map((item): PermissionFact => {
    const fact = object(item, ['entry', 'risk_level', 'copy_allowed', 'source_ref']);
    const risk = fact.risk_level;
    const parsed = parseContractSchema('MenokinSopQuerySopEntryPermission', {
      ...fact, risk_level: risk === 'unclassified' ? 'low' : risk, copy_allowed: fact.copy_allowed === null ? false : fact.copy_allowed,
    });
    if (parsed.source_ref !== `${sourceRef}@${sourceVersion}#${parsed.entry.businessEntryId}`) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    return { ...parsed, risk_level: risk === 'unclassified' ? 'unclassified' : parsed.risk_level,
      copy_allowed: fact.copy_allowed === null ? null : parsed.copy_allowed };
  });
  const document: SopQueryFactDocument = {
    candidateId: parseContractSchema('IntakeId', value.candidateId),
    candidateVersion: parseContractSchema('IntakeVersion', value.candidateVersion),
    sourceId: parseContractSchema('IntakeSopId', value.sourceId),
    flowId: parseContractSchema('IntakeSopId', value.flowId),
    graphDigest: parseContractSchema('IntakeSopHash', value.graphDigest), sopGroup: group, permissions,
  };
  return { sourceRef, sourceVersion, sourceSha256: digest(source.bytes), document };
}

/** This is an internal synthetic registration entry, with no HTTP writer. The
 * normal source import grant and original publication remain mandatory. */
export function createSyntheticSopQueryFactWriter(run: ReturnType<typeof createIntakeTransactions>) {
  return {
    write(actor: AuthenticatedUser, input: {
      operationId: string; expectedVersion: number; source: RegisteredSyntheticSopFacts;
    }) {
      const fact = parseSyntheticSopQueryFacts(input.source);
      const operationId = parseContractSchema('IntakeId', input.operationId);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
      const request = { ...fact, expectedVersion: input.expectedVersion };
      const decode = (value: unknown) => parseContractSchema('IntakeVersion', value);
      // Authorization happens before the SQL writer recovers a permanent receipt.
      return run(actor, 'sop-query-facts', null, null, async (client, who) => {
        // The SQL boundary checks the live import grant before receipt recovery
        // and derives provenance from the original publication, not source.current.
        try {
          const result = await client.query<{ value: unknown }>(
            'SELECT to_jsonb(content_intake.write_sop_query_facts($1,$2,$3::jsonb)) AS value',
            [who.id, operationId, canonical(request)],
          );
          return decode(result.rows[0]?.value);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ZA003') {
            if (error.message === 'IDEMPOTENCY_CONFLICT') throw new IntakeRejection('IDEMPOTENCY_CONFLICT');
            if (error.message === 'MATERIAL_CHANGED') throw new IntakeRejection('MATERIAL_CHANGED');
            if (error.message === 'SCOPE_DENIED') throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
          }
          throw error;
        }
      }, decode);
    },
  };
}
