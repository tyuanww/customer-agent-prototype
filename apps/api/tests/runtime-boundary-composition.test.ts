import { CONTRACT_PROVENANCE } from '@customer-agent/contracts/provenance';
import { describe, expect, it } from 'vitest';
import { SEARCH_BOUNDARY_FUNCTIONS, SEARCH_BOUNDARY_MANIFEST_SHA256, SEARCH_BOUNDARY_MANIFEST_SIZE } from '../src/features/search-runtime.js';
import {
  interpretRuntimeSchemaRow,
  RUNTIME_COLUMN_GRANTS,
  RUNTIME_FUNCTION_GRANTS,
  RUNTIME_POLICY_FLAGS_SQL,
  RUNTIME_RELATION_GRANTS,
  RUNTIME_SCHEMA_PROBE_SQL,
} from '../src/repository/runtime-boundary-probe.js';
import { createServiceRepositoryForPool } from '../src/service-repository.js';
import { parseListenPortToken, parseRequestedHost } from '../src/runtime-config/network.js';
import { parseDatabaseConfig } from '../src/runtime-config/database.js';
import { parseSessionModeToken } from '../src/runtime-config/session.js';
import { ApiConfigError, parseApiRuntimeConfig, type ApiConfigIssue } from '../src/runtime-config.js';

describe('runtime boundary composition', () => {
  it('puts search, content, and announce/ops grants in the one readiness statement', () => {
    expect(SEARCH_BOUNDARY_MANIFEST_SIZE).toBe(15);
    expect(RUNTIME_SCHEMA_PROBE_SQL).toContain('pg_catalog.count(*) = 15');
    expect(RUNTIME_SCHEMA_PROBE_SQL).toContain(SEARCH_BOUNDARY_MANIFEST_SHA256);
    expect(RUNTIME_SCHEMA_PROBE_SQL).not.toContain('schema_migrations');
    expect(RUNTIME_POLICY_FLAGS_SQL).toContain(RUNTIME_SCHEMA_PROBE_SQL);
    for (const signature of [...RUNTIME_FUNCTION_GRANTS, ...SEARCH_BOUNDARY_FUNCTIONS]) {
      expect(RUNTIME_SCHEMA_PROBE_SQL).toContain(`('${signature}')`);
    }
    for (const [relation, privilege] of RUNTIME_RELATION_GRANTS) {
      expect(RUNTIME_SCHEMA_PROBE_SQL).toContain(`('${relation}', '${privilege}')`);
    }
    for (const [relation, column, privilege] of RUNTIME_COLUMN_GRANTS) {
      expect(RUNTIME_SCHEMA_PROBE_SQL).toContain(`('${relation}', '${column}', '${privilege}')`);
    }
    expect(RUNTIME_SCHEMA_PROBE_SQL).toContain("'v_release_source_gate', 'v_scripts_recommendable'");
  });

  it('keeps the legacy ops_loop schema comment as the only v1.17 exception', () => {
    const ready = {
      database_probe: 1,
      server_version_num: 150_013,
      schema_comment: `CS-AI-C11 ${CONTRACT_PROVENANCE.database_version}; current`,
      ops_loop_comment: '',
      repository_boundary_present: true,
      runtime_identity_safe: true,
      runtime_effective_acl_safe: true,
      runtime_search_boundary_safe: true,
    };
    expect(interpretRuntimeSchemaRow(ready)).toEqual({ database: 'ok', schema: 'ok' });
    expect(interpretRuntimeSchemaRow({
      ...ready,
      schema_comment: 'CS-AI-C11 schema.v1.17; legacy',
      ops_loop_comment: `ops ${CONTRACT_PROVENANCE.database_version}`,
    })).toEqual({ database: 'ok', schema: 'ok' });
    expect(interpretRuntimeSchemaRow({
      ...ready,
      schema_comment: 'CS-AI-C11 schema.v1.17; legacy',
      ops_loop_comment: 'ops schema.v1.17',
    })).toEqual({ database: 'ok', schema: 'not_ready' });
    expect(interpretRuntimeSchemaRow(undefined)).toEqual({
      database: 'not_ready',
      schema: 'not_ready',
    });
  });

  it('fails closed search and events from the search runtime after close', async () => {
    const pool = {
      query: () => Promise.reject(new Error('query should not run')),
      end: () => Promise.resolve(),
      on: () => pool,
    };
    const repository = createServiceRepositoryForPool(pool as never);
    await repository.close();
    await expect(repository.searchCandidates({} as never)).rejects.toMatchObject({ code: '08003' });
    await expect(repository.executeSearch({} as never)).resolves.toEqual({ ok: false, code: 'OVERLOADED' });
    await expect(repository.recordAdoption({} as never)).resolves.toEqual({ ok: false, code: 'OVERLOADED' });
    await expect(repository.recordEscalation({} as never)).resolves.toEqual({ ok: false, code: 'OVERLOADED' });
    await expect(repository.readiness()).resolves.toMatchObject({
      database: 'not_ready',
      schema: 'not_ready',
    });
    await expect(repository.readPolicyFlags()).resolves.toBeNull();
  });
});

describe('runtime config groups', () => {
  it('leaves external bind and privileged ports to the cross-field owner', () => {
    const issues: ApiConfigIssue[] = [];
    expect(parseRequestedHost({ CUSTOMER_AGENT_API_HOST: '0.0.0.0' }, issues)).toBe('0.0.0.0');
    expect(parseListenPortToken({ CUSTOMER_AGENT_API_PORT: '0' }, issues)).toEqual({
      kind: 'numeric',
      port: 0,
    });
    expect(parseListenPortToken({ CUSTOMER_AGENT_API_PORT: '80' }, issues)).toEqual({
      kind: 'numeric',
      port: 80,
    });
    expect(issues).toEqual([]);

    expect(() => parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'formal-dev',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_HOST: '0.0.0.0',
    })).toThrow(ApiConfigError);
  });

  it('records both the bad session token and the product-only database fields', () => {
    const sessionIssues: ApiConfigIssue[] = [];
    expect(parseSessionModeToken({
      AUTH_SESSION_MODE: 'typo',
      AUTH_DATABASE_URL: 'postgresql://auth@127.0.0.1/synthetic',
    }, sessionIssues)).toBeUndefined();
    expect(sessionIssues).toEqual([{ field: 'AUTH_SESSION_MODE', reason: 'invalid' }]);

    try {
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'formal-dev',
        AUTH_MODE: 'mock',
        AUTH_SESSION_MODE: 'typo',
        AUTH_DATABASE_URL: 'postgresql://auth@127.0.0.1/synthetic',
      });
      throw new Error('expected the cross-field owner to reject the session');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiConfigError);
      const sessionIssuesOnOwner = (error as ApiConfigError).issues
        .filter((entry) => entry.field === 'AUTH_SESSION_MODE');
      expect(sessionIssuesOnOwner).toEqual([
        { field: 'AUTH_SESSION_MODE', reason: 'invalid' },
        { field: 'AUTH_SESSION_MODE', reason: 'invalid' },
      ]);
    }
  });

  it('parses one database target without comparing it to another pool', () => {
    const issues: ApiConfigIssue[] = [];
    const config = parseDatabaseConfig({
      DATABASE_URL: 'postgresql://same_login@127.0.0.1:5432/synthetic',
    }, {
      connectionString: 'DATABASE_URL',
      poolMax: 'DB_POOL_MAX',
      defaultPoolMax: 2,
    }, issues);
    expect(issues).toEqual([]);
    expect(config).toMatchObject({ poolMax: 2 });
  });
});
