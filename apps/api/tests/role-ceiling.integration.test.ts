import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { ROLE_CEILING, roleAllows, roleMayAllocate, roleMayDelegate, roleMaySkipImportParent } from '../src/content-intake/role-ceiling.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

type Row = Readonly<{
  role: string;
  business_actions: readonly string[];
  may_allocate: boolean;
  may_delegate: boolean;
  may_skip_import_parent: boolean;
}>;

/** `content_intake.role_ceiling` owns the boundary. `role-ceiling.ts` mirrors it because the
 *  directory projection and the grant preview cannot await a query. This test is what keeps
 *  them one answer: change either side alone and the suite fails. */
describe.skipIf(!enabled)('role ceiling agreement', () => {
  let harness: Pg15Harness;
  let admin: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('role_ceiling').config);
    await applyDatabaseMigrations(admin);
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('mirrors the table row for row', async () => {
    const { rows } = await admin.query<Row>(`SELECT role, business_actions, may_allocate, may_delegate,
        may_skip_import_parent FROM content_intake.role_ceiling ORDER BY role`);
    const fromSql = rows.map((row) => ({
      role: row.role,
      businessActions: [...row.business_actions],
      mayAllocate: row.may_allocate,
      mayDelegate: row.may_delegate,
      maySkipImportParent: row.may_skip_import_parent,
    }));
    const fromTs = Object.entries(ROLE_CEILING)
      .map(([role, value]) => ({
        role,
        businessActions: [...value.businessActions],
        mayAllocate: value.mayAllocate,
        mayDelegate: value.mayDelegate,
        maySkipImportParent: value.maySkipImportParent,
      }))
      .sort((a, b) => (a.role < b.role ? -1 : 1));
    expect(fromTs).toEqual(fromSql);
  });

  it('answers every predicate the same way the SQL functions do', async () => {
    const roles: (string | null)[] = ['director', 'manager', 'engineer', 'supervisor', 'lead', 'agent', 'enabler', null];
    const actions = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
    const disagreements: string[] = [];
    for (const role of roles) {
      const { rows } = await admin.query<{
        allows_query: boolean; may_allocate: boolean; may_delegate: boolean; may_skip_parent: boolean;
      }>(`SELECT content_intake.role_allows($1,'query') AS allows_query,
            content_intake.role_may_allocate($1) AS may_allocate,
            content_intake.role_may_delegate($1) AS may_delegate,
            content_intake.role_may_skip_import_parent($1) AS may_skip_parent`, [role]);
      const sql = rows[0]!;
      if (sql.allows_query !== roleAllows(role, 'query')) disagreements.push(`${role}/query allows`);
      if (sql.may_allocate !== roleMayAllocate(role)) disagreements.push(`${role} may_allocate`);
      if (sql.may_delegate !== roleMayDelegate(role)) disagreements.push(`${role} may_delegate`);
      if (sql.may_skip_parent !== roleMaySkipImportParent(role)) disagreements.push(`${role} may_skip_import_parent`);
      for (const action of actions) {
        const one = await admin.query<{ allowed: boolean }>(
          'SELECT content_intake.role_allows($1,$2) AS allowed', [role, action]);
        if (one.rows[0]!.allowed !== roleAllows(role, action)) disagreements.push(`${role}/${action} allows`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
