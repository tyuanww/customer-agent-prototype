import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
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

  it('registers the four text sources and the sop source without grants', async () => {
    const database = harness.createDatabase('menokin_sources');
    const client = await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);
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
        { source_id: 'src-menokin-sop', brand_id: 'brand-menokin', shop_id: 'shop-menokin', domain: 'sop', mode: 'legacy', mapping_version: 'not-imported' },
      ]);
      const sop = (await client.query<{ domain: string; mode: string; template_version: string }>(
        `SELECT s.domain, src.mode, m.template_version
         FROM content_intake.sources src
         JOIN content_intake.scopes s USING (scope_id)
         JOIN content_intake.source_mappings m ON m.source_id = src.source_id AND m.version = src.current_mapping_version
         WHERE src.source_id = 'src-menokin-sop'`,
      )).rows;
      expect(sop).toEqual([{ domain: 'sop', mode: 'legacy', template_version: 'sop-v1' }]);
      await expect(client.query("SELECT content_intake.delete_unused_sop_row('missing-candidate', 1, 'sop:过敏流程SOP:1')")).rejects.toThrow(/SOP_ROW_NOT_FOUND/);
      const acl = (await client.query<{ grant: string | null }>(
        `SELECT privilege_type AS grant FROM information_schema.routine_privileges
         WHERE specific_schema = 'content_intake' AND routine_name = 'delete_unused_sop_row' AND grantee = 'PUBLIC'`,
      )).rowCount;
      expect(acl).toBe(0);
      expect((await client.query("SELECT 1 FROM content_intake.grants WHERE source_id LIKE 'src-menokin-%'")).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  }, 180_000);
});
