import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Pool } from 'pg';
import { testDatabase, closeDatabasePool } from '../helpers/test-database.js';

describe('Wildcard source authorization (migration 0075)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await testDatabase();
  });

  afterAll(async () => {
    await closeDatabasePool(pool);
  });

  test('authorization_deadline should accept grants with source_id IS NULL', async () => {
    const client = await pool.connect();
    try {
      // 1. 创建测试主体和事实
      const principalId = 'test_wildcard_' + Date.now();
      const userId = 'usr_test_wildcard_' + Date.now();
      const tenantId = 'tenant-test';
      const appId = 'app-test';
      const departmentId = 'dept-test';
      const jobId = 'job-test-agent';

      // 插入测试用户绑定
      await client.query(`
        INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
        ) VALUES (
          $1, 'test', $2, 'Test Wildcard User', $3,
          encode(sha256(convert_to($1, 'UTF8')), 'hex'), true, 'agent'
        )
      `, [principalId, tenantId, userId]);

      // 插入策略版本
      await client.query(`
        INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
        VALUES ($1, $2, 1)
        ON CONFLICT DO NOTHING
      `, [tenantId, appId]);

      // 插入角色规则
      await client.query(`
        INSERT INTO content_intake.role_rules(
          tenant_id, app_id, department_id, job_id, policy_version, role
        ) VALUES ($1, $2, $3, $4, 1, 'agent')
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
      const scopeId = 'scope-test-wildcard';
      const sourceId1 = 'src-test-wildcard-1';
      const sourceId2 = 'src-test-wildcard-2';

      await client.query(`
        INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [scopeId, tenantId, appId]);

      await client.query(`
        INSERT INTO content_intake.sources(source_id, scope_id, mode)
        VALUES ($1, $2, 'v2-preview'), ($3, $2, 'v2-preview')
        ON CONFLICT DO NOTHING
      `, [sourceId1, scopeId, sourceId2]);

      // 3. 签发通配符授权（source_id IS NULL）
      const grantId = 'grant_test_wildcard_' + Date.now();
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, policy_version
        ) VALUES (
          $1, 'business', $2, $2, $3, $4, $5, NULL, 'query',
          now(), now() + interval '1 day', 'Test wildcard grant', $2, 1
        )
      `, [grantId, principalId, tenantId, appId, scopeId]);

      // 4. 验证通配符授权对 source1 有效
      const result1 = await client.query<{ deadline: Date | null }>(`
        SELECT content_intake.authorization_deadline(
          $1, 'query', $2, $3, now()
        ) AS deadline
      `, [principalId, scopeId, sourceId1]);

      expect(result1.rows[0]?.deadline).toBeTruthy();
      expect(result1.rows[0]?.deadline).toBeInstanceOf(Date);

      // 5. 验证通配符授权对 source2 也有效
      const result2 = await client.query<{ deadline: Date | null }>(`
        SELECT content_intake.authorization_deadline(
          $1, 'query', $2, $3, now()
        ) AS deadline
      `, [principalId, scopeId, sourceId2]);

      expect(result2.rows[0]?.deadline).toBeTruthy();
      expect(result2.rows[0]?.deadline).toBeInstanceOf(Date);

      // 6. 清理测试数据
      await client.query('DELETE FROM content_intake.grants WHERE grant_id = $1', [grantId]);
      await client.query('DELETE FROM content_intake.principal_facts WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.principals WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.role_rules WHERE tenant_id = $1 AND app_id = $2 AND department_id = $3',
        [tenantId, appId, departmentId]);
      await client.query('DELETE FROM backend_identity.subject_bindings WHERE binding_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.sources WHERE source_id IN ($1, $2)', [sourceId1, sourceId2]);
      await client.query('DELETE FROM content_intake.scopes WHERE scope_id = $1', [scopeId]);
    } finally {
      client.release();
    }
  });

  test('authorization_deadline should support both wildcard and exact source grants', async () => {
    const client = await pool.connect();
    try {
      // 1. 创建测试主体
      const principalId = 'test_mixed_' + Date.now();
      const userId = 'usr_test_mixed_' + Date.now();
      const tenantId = 'tenant-test';
      const appId = 'app-test';
      const departmentId = 'dept-test';
      const jobId = 'job-test-agent';

      // 插入测试用户绑定
      await client.query(`
        INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
        ) VALUES (
          $1, 'test', $2, 'Test Mixed User', $3,
          encode(sha256(convert_to($1, 'UTF8')), 'hex'), true, 'agent'
        )
      `, [principalId, tenantId, userId]);

      // 插入策略版本
      await client.query(`
        INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
        VALUES ($1, $2, 1)
        ON CONFLICT DO NOTHING
      `, [tenantId, appId]);

      // 插入角色规则
      await client.query(`
        INSERT INTO content_intake.role_rules(
          tenant_id, app_id, department_id, job_id, policy_version, role
        ) VALUES ($1, $2, $3, $4, 1, 'agent')
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
      const scopeId1 = 'scope-test-mixed-1';
      const scopeId2 = 'scope-test-mixed-2';
      const sourceId1 = 'src-test-mixed-1';
      const sourceId2 = 'src-test-mixed-2';

      await client.query(`
        INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id)
        VALUES ($1, $2, $3), ($4, $2, $3)
        ON CONFLICT DO NOTHING
      `, [scopeId1, tenantId, appId, scopeId2]);

      await client.query(`
        INSERT INTO content_intake.sources(source_id, scope_id, mode)
        VALUES ($1, $2, 'v2-preview'), ($3, $4, 'v2-preview')
        ON CONFLICT DO NOTHING
      `, [sourceId1, scopeId1, sourceId2, scopeId2]);

      // 3. 签发通配符授权（scope1, source_id IS NULL）
      const grantId1 = 'grant_test_mixed_wildcard_' + Date.now();
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, policy_version
        ) VALUES (
          $1, 'business', $2, $2, $3, $4, $5, NULL, 'query',
          now(), now() + interval '1 day', 'Test wildcard grant', $2, 1
        )
      `, [grantId1, principalId, tenantId, appId, scopeId1]);

      // 4. 签发精确授权（scope2, source2）
      const grantId2 = 'grant_test_mixed_exact_' + Date.now();
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, policy_version
        ) VALUES (
          $1, 'business', $2, $2, $3, $4, $5, $6, 'query',
          now(), now() + interval '1 day', 'Test exact grant', $2, 1
        )
      `, [grantId2, principalId, tenantId, appId, scopeId2, sourceId2]);

      // 5. 验证通配符授权（scope1, source1）
      const result1 = await client.query<{ deadline: Date | null }>(`
        SELECT content_intake.authorization_deadline(
          $1, 'query', $2, $3, now()
        ) AS deadline
      `, [principalId, scopeId1, sourceId1]);

      expect(result1.rows[0]?.deadline).toBeTruthy();

      // 6. 验证精确授权（scope2, source2）
      const result2 = await client.query<{ deadline: Date | null }>(`
        SELECT content_intake.authorization_deadline(
          $1, 'query', $2, $3, now()
        ) AS deadline
      `, [principalId, scopeId2, sourceId2]);

      expect(result2.rows[0]?.deadline).toBeTruthy();

      // 7. 清理测试数据
      await client.query('DELETE FROM content_intake.grants WHERE grant_id IN ($1, $2)', [grantId1, grantId2]);
      await client.query('DELETE FROM content_intake.principal_facts WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.principals WHERE principal_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.role_rules WHERE tenant_id = $1 AND app_id = $2 AND department_id = $3',
        [tenantId, appId, departmentId]);
      await client.query('DELETE FROM backend_identity.subject_bindings WHERE binding_id = $1', [principalId]);
      await client.query('DELETE FROM content_intake.sources WHERE source_id IN ($1, $2)', [sourceId1, sourceId2]);
      await client.query('DELETE FROM content_intake.scopes WHERE scope_id IN ($1, $2)', [scopeId1, scopeId2]);
    } finally {
      client.release();
    }
  });

  test('authorization_deadline function should contain OR branch for source_id check', async () => {
    const client = await pool.connect();
    try {
      // 验证函数定义中包含 source_id IS NULL 的 OR 分支
      const result = await client.query<{ prosrc: string }>(`
        SELECT prosrc
        FROM pg_proc
        WHERE proname = 'authorization_deadline'
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'content_intake')
      `);

      expect(result.rows[0]).toBeTruthy();
      const functionBody = result.rows[0]!.prosrc;

      // 验证包含 source_id IS NULL 的 OR 逻辑
      expect(functionBody).toContain('g.source_id IS NULL');
      expect(functionBody).toContain('OR');

      // 验证包含 source 存在性检查
      expect(functionBody).toContain('content_intake.sources');
      expect(functionBody).toContain('src.source_id = p_source');
    } finally {
      client.release();
    }
  });
});
