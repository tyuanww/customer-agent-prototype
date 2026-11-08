import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_ACTIONS,
  ACCESS_ROLES,
  AUTHORIZATION_MATRIX,
  ROLE_CEILING_POLICY,
  renderPolicyMatrixJson,
  renderRoleCeilingSeedSql,
} from '../src/index.js';

const packageRoot = new URL('../', import.meta.url);

function sqlInsertColumns(sql: string): string[] {
  const match = sql.match(/INSERT INTO content_intake\.role_ceiling \(([^)]+)\) VALUES/u);
  if (!match) throw new Error('missing role_ceiling insert columns');
  return match[1]!.split(',').map((column) => column.trim());
}

function sqlConflictKey(sql: string): string[] {
  const match = sql.match(/ON CONFLICT \(([^)]+)\) DO UPDATE/u);
  if (!match) throw new Error('missing role_ceiling conflict key');
  return match[1]!.split(',').map((column) => column.trim());
}

function migrationRows(sql: string): unknown[] {
  const insert = sql.match(/INSERT INTO content_intake\.role_ceiling\([^)]+\) VALUES\n([\s\S]*?);/u);
  if (!insert) throw new Error('missing role_ceiling rows');
  const rows = [];
  for (const match of insert[1]!.matchAll(
    /^\s*\('([^']+)',\s+ARRAY\[([^\]]*)\],\s+(true|false),\s+(true|false),\s+(true|false)\)/gmu,
  )) {
    const businessActions = [...match[2]!.matchAll(/'([^']+)'/gu)].map((action) => action[1]!);
    rows.push({
      role: match[1]!,
      businessActions,
      mayAllocate: match[3] === 'true',
      mayDelegate: match[4] === 'true',
      maySkipImportParent: match[5] === 'true',
    });
  }
  return rows.sort((left, right) =>
    (left as { role: string }).role.localeCompare((right as { role: string }).role));
}

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
    expect(actions.get('supervisor')).not.toContain('accounts-manage');
    expect(actions.get('supervisor')).not.toContain('grants-manage');
    expect(actions.get('lead')?.has('accounts-manage')).toBe(false);
    expect(actions.get('lead')?.has('grants-manage')).toBe(false);
    expect(actions.get('director')).toContain('grants-manage');
    expect(actions.get('director')).toContain('accounts-manage');
    expect(actions.get('manager')).toContain('grants-manage');
    expect(actions.get('manager')).toContain('accounts-manage');
    expect(actions.get('engineer')).toContain('grants-manage');
    expect(actions.get('engineer')).toContain('accounts-manage');
  });

  it('owns role capabilities in the same shape and values as the runtime ceiling', () => {
    expect(ROLE_CEILING_POLICY).toEqual([
      {
        role: 'agent',
        businessActions: ['query'],
        mayAllocate: false,
        mayDelegate: false,
        maySkipImportParent: false,
      },
      {
        role: 'director',
        businessActions: [
          'query', 'content-manage', 'import', 'source-confirm',
          'review', 'publish', 'candidate-cancel', 'rollback',
        ],
        mayAllocate: true,
        mayDelegate: true,
        maySkipImportParent: true,
      },
      {
        role: 'enabler',
        businessActions: ['query'],
        mayAllocate: false,
        mayDelegate: false,
        maySkipImportParent: false,
      },
      {
        role: 'engineer',
        businessActions: [
          'query', 'content-manage', 'import', 'source-confirm',
          'review', 'publish', 'candidate-cancel', 'rollback',
        ],
        mayAllocate: true,
        mayDelegate: true,
        maySkipImportParent: true,
      },
      {
        role: 'lead',
        businessActions: [
          'query', 'content-manage', 'import', 'source-confirm',
          'review', 'publish', 'candidate-cancel', 'rollback',
        ],
        mayAllocate: false,
        mayDelegate: false,
        maySkipImportParent: false,
      },
      {
        role: 'manager',
        businessActions: [
          'query', 'content-manage', 'import', 'source-confirm',
          'review', 'publish', 'candidate-cancel', 'rollback',
        ],
        mayAllocate: true,
        mayDelegate: true,
        maySkipImportParent: true,
      },
      {
        role: 'supervisor',
        businessActions: [
          'query', 'content-manage', 'import', 'source-confirm',
          'review', 'publish', 'candidate-cancel', 'rollback',
        ],
        mayAllocate: false,
        mayDelegate: false,
        maySkipImportParent: false,
      },
    ]);

    for (const policy of ROLE_CEILING_POLICY) {
      const entries = AUTHORIZATION_MATRIX.filter((entry) => entry.role === policy.role);
      for (const action of policy.businessActions) {
        expect(entries.some((entry) => entry.action === action && entry.scopeKind === 'source'))
          .toBe(true);
      }
      expect(entries.some((entry) => entry.action === 'grants-manage')).toBe(policy.mayAllocate);
      expect(entries.some((entry) => entry.action === 'accounts-manage')).toBe(policy.mayAllocate);
    }
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
    expect(sql).not.toContain('requires_current_facts');
    expect(sql).not.toContain('requires_database_check');
    expect(sql).toContain('ON CONFLICT (role) DO UPDATE');
  });

  it('matches the static shape and primary key of migration 0057', async () => {
    const migration = await readFile(
      new URL('../database/migrations/0057_role_ceiling.sql', packageRoot),
      'utf8',
    );
    const table = migration.match(
      /CREATE TABLE content_intake\.role_ceiling \(([\s\S]*?)\n\);/u,
    );
    if (!table) throw new Error('missing role_ceiling table definition');
    const migrationColumns = [...table[1]!.matchAll(/^\s{2}([a-z_]+)\s+/gmu)]
      .map((match) => match[1]!);
    const primaryKeyColumns = [...table[1]!.matchAll(
      /^\s{2}([a-z_]+)\s+[^\n]+PRIMARY KEY/gmu,
    )].map((match) => match[1]!);
    const sql = renderRoleCeilingSeedSql();

    expect(sqlInsertColumns(sql)).toEqual(migrationColumns);
    expect(sqlConflictKey(sql)).toEqual(primaryKeyColumns);
    expect(sqlConflictKey(sql)).toEqual(['role']);
    expect(ROLE_CEILING_POLICY).toEqual(migrationRows(migration));
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
