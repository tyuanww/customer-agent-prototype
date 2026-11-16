import { parseContractSchema } from '@customer-agent/contracts/sop-unified';
import type { AuthenticatedUser } from './auth-service.js';
import { canonical, digest } from './content-intake/material.js';
import { authorize, source } from './content-intake/authority.js';
import { IntakeRejection, lockProductSession, type createIntakeTransactions } from './content-intake/transaction.js';
import { parseSopQueryFactDocument } from './sop-unified-query-facts.js';

export type OwnerReviewedSopFactSource = {
  version: string;
  bytes: Buffer;
};

/** The document identifies a local owner-reviewed file snapshot. It makes no upstream revision claim. */
export function parseOwnerReviewedSopFacts(source: OwnerReviewedSopFactSource) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(source.version) || source.bytes.length > 1_048_576
    || !source.bytes.equals(Buffer.from(source.bytes.toString('utf8'), 'utf8'))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const sourceText = source.bytes.toString('utf8');
  let value: unknown;
  try { value = JSON.parse(sourceText); }
  catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'artifactSha256,document,kind,originalSha256,reviewedByPrincipalId'
    || !('kind' in value) || value.kind !== 'owner-reviewed-file'
    || !('originalSha256' in value) || !('artifactSha256' in value)
    || !('reviewedByPrincipalId' in value) || !('document' in value)) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const originalSha256 = parseContractSchema('IntakeSopHash', value.originalSha256);
  const artifactSha256 = parseContractSchema('IntakeSopHash', value.artifactSha256);
  const reviewedByPrincipalId = parseContractSchema('IntakeId', value.reviewedByPrincipalId);
  const sourceRef = `owner-reviewed-file:${originalSha256}`;
  return {
    sourceVersion: source.version,
    sourceText,
    sourceSha256: digest(source.bytes),
    originalSha256,
    artifactSha256,
    reviewedByPrincipalId,
    document: parseSopQueryFactDocument(value.document, { ref: sourceRef, version: source.version }),
  };
}

/** Internal registration requires a current product session and explicit source permissions.
 * Callers supply exact reviewed bytes. No HTTP or renderer writer is registered. */
export function createOwnerReviewedSopQueryFactWriter(run: ReturnType<typeof createIntakeTransactions>) {
  return {
    write(actor: AuthenticatedUser, input: {
      operationId: string;
      expectedVersion: number;
      source: OwnerReviewedSopFactSource;
    }) {
      const fact = parseOwnerReviewedSopFacts(input.source);
      const operationId = parseContractSchema('IntakeId', input.operationId);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
      }
      const decode = (value: unknown) => parseContractSchema('IntakeVersion', value);
      const request = { sourceText: fact.sourceText, sourceVersion: fact.sourceVersion,
        sourceSha256: fact.sourceSha256, expectedVersion: input.expectedVersion };
      return run(actor, 'owner-reviewed-sop-query-facts', null, null, async (client, who) => {
        await lockProductSession(client, actor);
        if (who.role !== 'director' || who.id !== fact.reviewedByPrincipalId) {
          throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        }
        const registeredSource = await source(client, fact.document.sourceId);
        await authorize(client, who, 'import', registeredSource);
        await authorize(client, who, 'source-confirm', registeredSource);
        try {
          const result = await client.query<{ value: unknown }>(
            'SELECT to_jsonb(content_intake.write_owner_reviewed_sop_query_facts($1,$2,$3::jsonb)) AS value',
            [who.id, operationId, canonical(request)],
          );
          return decode(result.rows[0]?.value);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ZA003') {
            if (error.message === 'SCOPE_DENIED') throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
            if (error.message === 'MATERIAL_CHANGED') throw new IntakeRejection('MATERIAL_CHANGED');
            if (error.message === 'IDEMPOTENCY_CONFLICT') throw new IntakeRejection('IDEMPOTENCY_CONFLICT');
            if (error.message === 'SOURCE_MISMATCH') throw new IntakeRejection('SOURCE_MISMATCH');
            if (error.message === 'SOP_DEPENDENCY_INVALID') throw new IntakeRejection('SOP_DEPENDENCY_INVALID');
            if (error.message === 'FILE_INVALID') throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
          }
          throw error;
        }
      }, decode);
    },
  };
}
