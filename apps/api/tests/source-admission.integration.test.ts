import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { admitLegacyWordingSources } from '../src/content-intake/source-admission.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

describe.skipIf(!enabled)('admit legacy wording sources without copying a release', () => {
  let harness: Pg15Harness;
  let client: Client;
  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('source_admission');
    client = await harness.connect(db.config);
    await applyDatabaseMigrations(client);
  }, 60_000);
  afterEach(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  it('promotes the registered wording sources and leaves lineage empty', async () => {
    const before = (await client.query<{ source_id: string; mode: string; mode_version: string }>(
      `SELECT source_id, mode, mode_version::text FROM content_intake.sources ORDER BY source_id`,
    )).rows;
    const admitted = await admitLegacyWordingSources(client, { tenantId: 'tenant-menokin', appId: 'app-customer-agent' });
    expect(admitted).toEqual([
      'src-menokin-aftersale',
      'src-menokin-campaign',
      'src-menokin-faq',
      'src-menokin-presale',
    ]);
    const after = (await client.query<{ source_id: string; mode: string; mode_version: string }>(
      `SELECT source_id, mode, mode_version::text FROM content_intake.sources ORDER BY source_id`,
    )).rows;
    const beforeById = new Map(before.map(row => [row.source_id, row]));
    for (const row of after) {
      const prior = beforeById.get(row.source_id);
      expect(prior).toBeDefined();
      if (admitted.includes(row.source_id)) {
        expect(prior?.mode).toBe('legacy');
        expect(row.mode).toBe('v2-preview');
        expect(Number(row.mode_version)).toBe(Number(prior?.mode_version) + 1);
      } else {
        expect(row).toEqual(prior);
      }
    }
    expect(after.find(row => row.source_id === 'src-menokin-sop')).toMatchObject({ mode: 'legacy' });
    expect(await admitLegacyWordingSources(client, { tenantId: 'tenant-menokin', appId: 'app-customer-agent' })).toEqual([]);
    expect((await client.query('SELECT count(*)::int AS count FROM content_intake.release_lineage')).rows[0].count).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS count FROM public.content_releases WHERE release_id LIKE 'rel_2%'`)).rows[0].count).toBe(0);
  });

  it('can admit one wording source and leave the other legacy locks closed', async () => {
    const admitted = await admitLegacyWordingSources(client, { tenantId: 'tenant-menokin', appId: 'app-customer-agent' }, ['src-menokin-faq']);
    expect(admitted).toEqual(['src-menokin-faq']);
    const modes = (await client.query<{ source_id: string; mode: string }>(
      `SELECT source_id, mode FROM content_intake.sources ORDER BY source_id`,
    )).rows;
    expect(modes.find(row => row.source_id === 'src-menokin-faq')).toMatchObject({ mode: 'v2-preview' });
    expect(modes.filter(row => row.source_id !== 'src-menokin-faq').every(row => row.mode === 'legacy')).toBe(true);
    expect((await client.query('SELECT count(*)::int AS count FROM content_intake.release_lineage')).rows[0].count).toBe(0);
  });
});
