import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSubjectBindingPeople } from '../../../scripts/synthetic-stack/subject-binding-people.js';
import { createSeatAccount } from '../../../scripts/synthetic-stack/seat-accounts.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** A seat must be grantable. `authorization_deadline` joins `role_rules`, so a binding with no
 *  principal and no role rule is a dead account however many grants it receives. The post sets
 *  the band: 客服主管 reaches the supervisor band, 客服 stays query-only. */
describe.skipIf(!enabled)('seat provisioning', () => {
  it('registers a principal and a role rule for each post', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const client: Client = await harness.connect(harness.createDatabase('seat_prov').config);
    try {
      await applyDatabaseMigrations(client);
      // The stack seeds the intake home; mimic the minimum the seat write depends on.
      await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
        VALUES ('tenant-menokin','app-customer-agent',1) ON CONFLICT DO NOTHING`);

      const sql = {
        async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
          const result = await client.query<T>(text, values);
          return { rowCount: result.rowCount, rows: result.rows };
        },
      };
      const people = createSubjectBindingPeople(sql as never);
      const passwords = {
        prepare: async () => ({ ok: true as const, account: { username: 'x', bindingId: 'x', salt: 's', hash: 'h' } }),
        write: async () => ({ ok: true as const }),
        replace: async () => ({ ok: true as const }),
        list: async () => ({ ok: true as const, rows: [] }),
      };

      for (const [username, post] of [['seat_a', '客服'], ['seat_b', '客服主管']] as const) {
        const created = await createSeatAccount(people, passwords as never, {
          displayName: `合成${post}`, username, password: 'pw-123456', post,
        });
        expect(created.ok, JSON.stringify(created)).toBe(true);
      }

      const rows = await client.query<{ binding_id: string; role: string }>(
        `SELECT binding_id, role FROM backend_identity.subject_bindings
          WHERE binding_id IN ('synthetic_seat_a','synthetic_seat_b') ORDER BY binding_id`);

      const principals = await client.query<{ principal_id: string; job_id: string }>(
        `SELECT person.principal_id, facts.job_id
           FROM content_intake.principals person
           JOIN content_intake.principal_facts facts
             ON facts.principal_id=person.principal_id AND facts.facts_version=person.current_facts_version
          WHERE person.principal_id IN ('synthetic_seat_a','synthetic_seat_b') ORDER BY person.principal_id`);

      const rules = await client.query<{ job_id: string; role: string }>(
        `SELECT job_id, role FROM content_intake.role_rules
          WHERE job_id IN ('job-seat','job-seat-supervisor') ORDER BY job_id`);

      expect(principals.rows).toHaveLength(2);
      expect(rules.rows).toEqual([
        { job_id: 'job-seat', role: 'agent' },
        { job_id: 'job-seat-supervisor', role: 'supervisor' },
      ]);
      expect(rows.rows).toEqual([
        { binding_id: 'synthetic_seat_a', role: 'agent' },
        { binding_id: 'synthetic_seat_b', role: 'coach' },
      ]);
    } finally { await client.end(); harness.stop(); }
  }, 180_000);
});
