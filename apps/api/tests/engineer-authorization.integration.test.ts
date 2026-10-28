import { describe, test, expect, beforeAll } from 'bun:test';
import { Pool } from 'pg';
import { testDatabase, closeDatabasePool } from '../helpers/test-database.js';

describe('Engineer role authorization (migration 0074)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await testDatabase();
  });

  afterAll(async () => {
    await closeDatabasePool(pool);
  });

  test('engineer role should be included in authorization_deadline', async () => {
    const client = await pool.connect();
    try {
      // 1. 创建测试主体和事实
      const principalId = 'test_engineer_' + Date.now();
      const userId = 'usr_test_engineer_' + Date.now();
      const tenantId = 'tenant-test';
      const appId = 'app-test';
      const departmentId = 'dept-test';
      const jobId = 'job-test-engineer';

      // 插入测试用户绑定
      await client.query(`
        INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
        ) VALUES (
          $1, 'test', $2, 'Test Engineer', $3,
          encode(sha256(convert_to($1, 'UTF8')), 'hex'), true, 'agent'
        )
      `, [principalId, tenantId, userId]);

      // 插入策略版本
      await client.query(`
        INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
        VALUES ($1, $2, 1)
        ON CONFLICT DO NOTHING
      `, [tenantId, appId]);

      // 插入角色规则（engineer 角色）
      await client.query(`
        INSERT INTO content_intake.role_rules(
          tenant_id, app_id, department_id, job_id, policy_version, role
        ) VALUES ($1, $2, $3, $4, 1, 'engineer')
        ON CONFLICT DO NOTHING
      `, [tenantId, appId, departmentId, jobId]);

      // 插入主体
      await client.query(`
        INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
        ) VALUES ($1, $2, $3, $4, 'test', $1, 1)
      `, [principalId, userId, tenantId, appId]);

      // 插入事实
      const digest = require('crypto').createHash('sha256')
        .update(principalId + departmentId + jobId).digest('hex');
      await client.query(`
        INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
        ) VALUES (
          $1, 1, ARRAY[$2], $3, true,
          now(), now() + interval '24 hours', $4
        )
      `, [principalId, departmentId, jobId, digest]);

      // 2. 创建测试范围和来源
      const scopeId = 'scope-test';
      const sourceId = 'src-test';

      await client.query(`
        INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [scopeId, tenantId, appId]);

      await client.query(`
        INSERT INTO content_intake.sources(source_id, scope_id, mode)
        VALUES ($1, $2, 'v2-preview')
        ON CONFLICT DO NOTHING
      `, [sourceId, scopeId]);

      // 3. 签发授权（business 类型）
      const grantId = 'grant_test_engineer_' + Date.now();
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, policy_version
        ) VALUES (
          $1, 'business', $2, $2, $3, $4, $5, $6, 'query',
          now(), now() + interval '1 day', 'Test grant', $2, 1
        )
      `, [grantId, principalId, tenantId, appId, scopeId, sourceId]);

      // 4. 调用 authorization_deadline 函数
      const result = await client.query<{ deadline: Date | null }>(`
        SELECT content_intake.authorization_deadline(
          $1, 'query', $2, $3, now()
        ) AS deadline
      `, [principalId, scopeId, sourceId]);

      // 5. 验证结果
      expect(result.rows[0]?.deadline).toBeTruthy();
      expect(result.rows[0]?.deadline).toBeInstanceOf(Date);

      // 6. 清理测试数据
      await client.query('DELETE FROM content_intake.grants WHERE grant_id = $1', [grantId]);
      await client.query('DELETE FROM content_intake.principal_facts WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.principals WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.role_rules WHERE tenant_id = $1 AND app_id = $2 AND department_id = $3',
        [tenantId, appId, departmentId]);
      await client.query('DELETE FROM backend_identity.subject_bindings WHERE binding_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.sources WHERE source_id = $1', [sourceId]);
      await client.query('DELETE FROM content_intake.scopes WHERE scope_id = $1', [scopeId]);
    } finally {
      client.release();
    }
  });

  test('engineer role should support all business actions defined in role_ceiling', async () => {
    const client = await pool.connect();
    try {
      // 查询 engineer 角色允许的动作
      const result = await client.query<{ business_actions: string[] }>(`
        SELECT business_actions
        FROM content_intake.role_ceiling
        WHERE role = 'engineer'
      `);

      expect(result.rows[0]).toBeTruthy();
      const actions = result.rows[0]!.business_actions;

      // 验证包含预期的动作
      expect(actions).toContain('query');
      expect(actions).toContain('content-manage');
      expect(actions).toContain('import');
      expect(actions).toContain('source-confirm');
      expect(actions).toContain('review');
      expect(actions).toContain('publish');
      expect(actions).toContain('candidate-cancel');
      expect(actions).toContain('rollback');

      // 验证动作数量
      expect(actions.length).toBe(8);
    } finally {
      client.release();
    }
  });

  test('authorization_deadline should use role_ceiling dynamically', async () => {
    const client = await pool.connect();
    try {
      // 验证函数定义中包含 role_ceiling JOIN
      const result = await client.query<{ prosrc: string }>(`
        SELECT prosrc
        FROM pg_proc
        WHERE proname = 'authorization_deadline'
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'content_intake')
      `);

      expect(result.rows[0]).toBeTruthy();
      const functionBody = result.rows[0]!.prosrc;

      // 验证包含 role_ceiling JOIN
      expect(functionBody).toContain('role_ceiling');
      expect(functionBody).toContain('rc.business_actions');
      expect(functionBody).toContain('p_action = ANY(rc.business_actions)');

      // 验证不再硬编码角色列表（旧的 HAVING 子句）
      expect(functionBody).not.toContain("IN ('director','manager','supervisor','lead','agent','enabler')");
    } finally {
      client.release();
    }
  });
});
