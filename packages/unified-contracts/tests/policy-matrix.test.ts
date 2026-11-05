import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_ACTIONS,
  ACCESS_ROLES,
  AUTHORIZATION_MATRIX,
  renderPolicyMatrixJson,
  renderRoleCeilingSeedSql,
} from '../src/index.js';

const packageRoot = new URL('../', import.meta.url);

describe('canonical authorization matrix', () => {
  it('defines each role and action exactly once', () => {
    expect(new Set(ACCESS_ROLES).size).toBe(ACCESS_ROLES.length);
    expect(new Set(ACCESS_ACTIONS).size).toBe(ACCESS_ACTIONS.length);
    expect(ACCESS_ROLES).toEqual([
      'agent',
      'director',
      'enabler',
      'engineer',
      'lead',
      'manager',
      'supervisor',
    ]);
    expect(ACCESS_ACTIONS).toEqual([
      'query',
      'content-manage',
      'import',
      'source-confirm',
      'review',
      'publish',
      'candidate-cancel',
      'rollback',
      'dashboard-read',
      'grants-manage',
      'accounts-manage',
    ]);
  });

  it('keeps Query, review administrator, and owner capabilities distinct', () => {
    const actions = new Map<string, Set<string>>();
    for (const entry of AUTHORIZATION_MATRIX) {
      const key = entry.role;
      const current = actions.get(key) ?? new Set<string>();
      current.add(entry.action);
      actions.set(key, current);
    }

    expect(actions.get('agent')).toEqual(new Set(['query']));
    expect(actions.get('enabler')).toEqual(new Set(['query']));
    expect(actions.get('supervisor')).toContain('accounts-manage');
    expect(actions.get('supervisor')).not.toContain('grants-manage');
    expect(actions.get('lead')?.has('accounts-manage')).toBe(true);
    expect(actions.get('lead')?.has('grants-manage')).toBe(false);
    expect(actions.get('director')).toContain('grants-manage');
    expect(actions.get('director')).toContain('accounts-manage');
    expect(actions.get('manager')).toContain('grants-manage');
    expect(actions.get('engineer')).toContain('accounts-manage');
  });

  it('generates byte-identical JSON and SQL twice from the same matrix', () => {
    const json = renderPolicyMatrixJson();
    const sql = renderRoleCeilingSeedSql();
    expect(renderPolicyMatrixJson()).toBe(json);
    expect(renderRoleCeilingSeedSql()).toBe(sql);
    expect(json.endsWith('\n')).toBe(true);
    expect(sql.endsWith('\n')).toBe(true);
    expect(sql.match(/-- GENERATED FILE/g)).toHaveLength(1);
    expect(sql).toContain('INSERT INTO content_intake.role_ceiling');
    expect(sql).not.toContain("'grants-manage'");
    expect(sql).not.toContain("'accounts-manage'");
  });

  it('rejects hand edits to generated artifacts', async () => {
    const [json, sql] = await Promise.all([
      readFile(new URL('generated/policy-matrix.generated.json', packageRoot), 'utf8'),
      readFile(new URL('generated/role-ceiling.seed.generated.sql', packageRoot), 'utf8'),
    ]);
    expect(json).toBe(renderPolicyMatrixJson());
    expect(sql).toBe(renderRoleCeilingSeedSql());
  });
});
