import {
  parseSopReleaseProjection,
  type SopReleaseProjection,
} from '@customer-agent/content-intake';
import type { IntakeTransaction } from './transaction.js';

/** A workbook is parsed as SOP only when the source is the SOP registration.
 * The consumed response schema still omits domain sop, so the synthetic fixture
 * opts in with mapping version sop-not-imported while its domain stays product.
 * The registered Menokin source matches the first three checks. */
export function sourceUsesSopWorkbook(source: {
  scope: { domain: string };
  templateVersion: string;
  ruleVersion: string;
  mappingVersion: string;
}): boolean {
  const domain: string = source.scope.domain;
  return domain === 'sop'
    || source.templateVersion === 'sop-v1'
    || source.ruleVersion === 'sop-not-imported'
    || source.mappingVersion === 'sop-not-imported';
}

/** Read the publication projection without rebuilding the index. Authorization
 * remains the caller's responsibility; this function only parses release data. */
export async function readSopReleaseProjection(
  client: Pick<IntakeTransaction, 'query'>,
  releaseId: string,
): Promise<SopReleaseProjection | null> {
  const { rows } = await client.query<{ value: unknown }>(
    'SELECT content_intake.read_sop_release_projection($1) AS value',
    [releaseId],
  );
  const value = rows[0]?.value;
  return value === null || value === undefined ? null : parseSopReleaseProjection(value);
}
