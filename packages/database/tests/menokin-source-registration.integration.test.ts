import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pg15Harness } from '../src/testkit/index.js';

const registrationSql = readFileSync(path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../seeds/menokin-source-registration.sql',
), 'utf8');

const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';

describe.skipIf(!enabled)('Menokin source registration', () => {
  const harness = new Pg15Harness();
  beforeAll(() => harness.start(), 120_000);
  afterAll(() => harness.stop());

  it('registers the four text sources and does not insert SOP or grants', async () => {
    const database = harness.createDatabase('menokin_sources');
    const client = await harness.connect(database.config);
    try {
      // Source tables exist by 0034. 0035 rechecks a catalogue that 0036 no longer matches.
      const migrationDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
      const files = readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name) && name < '0035_').sort();
      for (const file of files) {
        await client.query('BEGIN');
        await client.query(readFileSync(path.join(migrationDir, file), 'utf8'));
        await client.query('COMMIT');
      }
      await client.query(registrationSql);
      await client.query(registrationSql);
      const rows = (await client.query<{
        source_id: string; brand_id: string; shop_id: string; domain: string; mode: string; mapping_version: string;
      }>(`SELECT src.source_id, s.brand_id, s.shop_id, s.domain, src.mode, m.mapping_version
        FROM content_intake.sources src
        JOIN content_intake.scopes s USING (scope_id)
        JOIN content_intake.source_mappings m ON m.source_id = src.source_id AND m.version = src.current_mapping_version
        WHERE src.source_id LIKE 'src-menokin-%'
        ORDER BY src.source_id`)).rows;
      expect(rows).toEqual([
        { source_id: 'src-menokin-aftersale', brand_id: 'brand-menokin', shop_id: 'shop-menokin', domain: 'aftersale', mode: 'legacy', mapping_version: 'not-imported' },
        { source_id: 'src-menokin-campaign', brand_id: 'brand-menokin', shop_id: 'shop-menokin', domain: 'campaign', mode: 'legacy', mapping_version: 'not-imported' },
        { source_id: 'src-menokin-faq', brand_id: 'brand-menokin', shop_id: 'shop-menokin', domain: 'product', mode: 'legacy', mapping_version: 'not-imported' },
        { source_id: 'src-menokin-presale', brand_id: 'brand-menokin', shop_id: 'shop-menokin', domain: 'presale', mode: 'legacy', mapping_version: 'not-imported' },
      ]);
      expect((await client.query("SELECT 1 FROM content_intake.sources WHERE source_id='src-menokin-sop'")).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM content_intake.grants WHERE source_id LIKE 'src-menokin-%'")).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  }, 180_000);
});
