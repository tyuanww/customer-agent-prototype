import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Explicit test input, never a production migration/intake path. Copy the DRAFT
 * into an external test directory before running; absent opt-in preserves the
 * ordinary suite. A missing or drifted candidate fails before any DB starts. */
export function publicationCandidateSql(): string | null {
  const directory = process.env.CUSTOMER_AGENT_PUBLICATION_CANDIDATE_DIR;
  if (!directory) return null;
  if (!path.isAbsolute(directory)) throw new Error('Candidate input must be an absolute test directory');
  const bytes = readFileSync(path.join(directory, 'publisher.candidate.sql'));
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (manifest.status !== 'DRAFT' || manifest.runtimeActivated !== false || manifest.productionConsumerReady !== false
    || manifest.artifacts?.['publisher.candidate.sql'] !== sha
    || sha !== '268b0ecc1b25d7c9d55c737e2e60040d1abef923f88c83dd68f0a4bc4f8df813') throw new Error('Publication candidate input drift');
  return bytes.toString('utf8');
}
