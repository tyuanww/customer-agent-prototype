import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(
  path.join(projectRoot, 'packages/database/migrations/manifest.generated.json'),
  'utf8',
)) as {
  migrations: Array<{ position: number; id: string; file: string; sha256: string }>;
};

const sources = [
  {
    position: 82,
    id: '0082_access_evaluator',
    source: 'packages/database/overlays/0082_access_evaluator.sql',
    sha256: '5db1a1883a053c384d7d9eaad1f4784a0ca426ca0cb32269d987a298292c9df0',
  },
  {
    position: 83,
    id: '0083_sop_pipeline_projection',
    source: 'packages/database/overlays/0083_sop_pipeline_projection.sql',
    sha256: '79e81732e716558e286f31fd8efcd3fa8737666324e8aed78e9df73be5f525e2',
  },
] as const;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('verified product migration sources', () => {
  it.each(sources)('preserves $id source bytes inside the generated migration', ({ position, id, source, sha256: sourceSha }) => {
    const sourceSql = readFileSync(path.join(projectRoot, source), 'utf8');
    const entry = manifest.migrations[position - 1];
    expect(entry).toMatchObject({ position, id, file: `${id}.sql` });
    expect(sha256(sourceSql)).toBe(sourceSha);

    const migrationSql = readFileSync(
      path.join(projectRoot, 'packages/database/migrations', `${id}.sql`),
      'utf8',
    );
    expect(migrationSql).toContain(sourceSql);
    expect(sha256(migrationSql)).toBe(entry?.sha256);
  });

  it('keeps ACL before SOP at the end of the ordered catalogue', () => {
    expect(manifest.migrations.slice(-2).map(({ position, id }) => ({ position, id }))).toEqual([
      { position: 82, id: '0082_access_evaluator' },
      { position: 83, id: '0083_sop_pipeline_projection' },
    ]);
  });
});
