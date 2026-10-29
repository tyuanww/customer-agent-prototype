import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { feishuUserId } from '../src/feishu-admit.js';
import { rosterPrincipalId } from '../src/project-roster-login.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

describe.skipIf(!enabled)('manual identity bounded transition property', () => {
  let harness: Pg15Harness;
  let client: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    client = await harness.connect(harness.createDatabase('manual_identity_property').config);
    await applyDatabaseMigrations(client);
    await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
      VALUES ('tenant-test','app-test',1)`);
    await client.query(`INSERT INTO content_intake.role_rules(
      tenant_id,app_id,department_id,job_id,policy_version,role)
      VALUES ('tenant-test','app-test','dept-candidate','job-candidate-agent',1,'agent')`);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  function candidates(depth: number): readonly string[][] {
    const sequenceCount = 2 ** depth;
    return Array.from({ length: sequenceCount }, (_, mask) =>
      Array.from({ length: depth }, (_, index) => mask & (1 << index) ? 'disable' : 'login'));
  }

  it('never creates a grant and never revives a disabled candidate for every transition sequence through depth 6', async () => {
    let run = 0;
    for (let depth = 1; depth <= 6; depth += 1) {
      for (const sequence of candidates(depth)) {
        run += 1;
        const openId = `ou_property${String(run).padStart(6, '0')}`;
        const principalId = rosterPrincipalId(openId);
        await client.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
        const initial = await client.query<{ status: string }>(`SELECT
          content_intake.project_feishu_candidate(
            $1,'tenant-test','app-test',$2,'dept-candidate','job-candidate-agent') AS status`,
        [feishuUserId(openId), openId]);
        expect(initial.rows[0]?.status).toBe('registered');

        let disabled = false;
        for (const transition of sequence) {
          if (transition === 'disable' && !disabled) {
            await client.query(
              "SELECT content_intake.withdraw_roster_query($1,'tenant-test','app-test')",
              [principalId],
            );
            disabled = true;
          }
          const projected = await client.query<{ status: string }>(`SELECT
            content_intake.project_feishu_candidate(
              $1,'tenant-test','app-test',$2,'dept-candidate','job-candidate-agent') AS status`,
          [feishuUserId(openId), openId]);
          expect(projected.rows[0]?.status).toBe(disabled ? 'inactive' : 'registered');
          const state = await client.query<{ enabled: boolean; grants: string }>(`
            SELECT facts.enabled,
              (SELECT count(*)::text FROM content_intake.grants
                WHERE recipient_id=$1 AND kind='business') AS grants
            FROM content_intake.principals person
            JOIN content_intake.principal_facts facts
              ON facts.principal_id=person.principal_id
             AND facts.facts_version=person.current_facts_version
            WHERE person.principal_id=$1`, [principalId]);
          expect(state.rows[0]).toEqual({ enabled: !disabled, grants: '0' });
        }
      }
    }
  }, 120_000);
});
