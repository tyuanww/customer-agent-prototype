import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DatabaseMigrationError } from '../src/errors.js';
import { generatedMigrationCatalogue } from '../src/generated/migrations.generated.js';
import {
  assertMigrationCatalogue,
  deriveMigrationStatus,
  inspectMigrationCatalogue,
  planMigrationCatalogue,
} from '../src/planner.js';
import type { DatabaseQueryClient, ExecutableMigrationCatalogue } from '../src/types.js';

function ledgerRow(index: number) {
  const migration = generatedMigrationCatalogue.migrations[index];
  if (!migration) throw new Error(`missing generated migration ${index}`);
  return {
    position: migration.position,
    migration_id: migration.id,
    migration_sha256: migration.sha256,
    contract_set_id: migration.contractSetId,
    source_git_sha: migration.sourceGitSha,
    source_schema_sha256: migration.sourceSchemaSha256,
    applied_at: new Date('2026-09-02T00:00:00.000Z'),
    execution_ms: index + 1,
  };
}

describe('database migration planner', () => {
  it('accepts only the declared repair at position 40 after the additive predecessor', () => {
    const prefix = generatedMigrationCatalogue.migrations.slice(0, 39);
    const repair = { contractSetId: 'cs-ai-c11-openapi-1.24.0-schema-1.28-' + 'a'.repeat(12),
      sourceGitSha: 'a'.repeat(40), sourceSchemaSha256: 'b'.repeat(64) };
    const sql = '-- GENERATED FILE. Synthetic repair test\nSELECT 1;';
    const migration = { ...repair, position: 40, id: '0040_intake_repair_successor_v1_28',
      bytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex'), sourceRanges: [], sql };
    const catalogue = { ...generatedMigrationCatalogue, migrations: [...prefix, migration],
      compatibility: { ...generatedMigrationCatalogue.compatibility, repairSuccessor: { ...repair, migrationSha256: migration.sha256 } } };
    expect(() => assertMigrationCatalogue(catalogue)).not.toThrow();
    for (const change of [{ id: '0040_unapproved' }, { sourceGitSha: 'c'.repeat(40) }]) {
      expect(() => assertMigrationCatalogue({ ...catalogue, migrations: [...prefix, { ...migration, ...change }] })).toThrow(DatabaseMigrationError);
    }
    expect(() => assertMigrationCatalogue({ ...catalogue,
      compatibility: { ...catalogue.compatibility, repairSuccessor: null } })).toThrow(DatabaseMigrationError);
  });

  it('accepts identical wire-only predecessor prefixes before a later overlay and rejects duplicate identities or changed DDL', () => {
    const quality = { contractSetId: 'cs-ai-c11-openapi-1.18.0-schema-1.21-18297cf802b1',
      sourceGitSha: '18297cf802b195d8ff4e9f625143e50bff169418',
      sourceSchemaSha256: '5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013', migrationCount: 26 };
    const beforeQuality = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(p => p.contractSetId !== quality.contractSetId && p.migrationCount <= quality.migrationCount);
    const afterQuality = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(p => p.migrationCount > quality.migrationCount);
    const catalogue = { ...generatedMigrationCatalogue,
      compatibility: { ...generatedMigrationCatalogue.compatibility, priorReviewedUpgrades: [...beforeQuality, quality, ...afterQuality] } };
    expect(() => assertMigrationCatalogue(catalogue)).not.toThrow();
    const status = deriveMigrationStatus(generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index)), catalogue);
    expect(status.state).toBe('COMPLETE');
    expect(planMigrationCatalogue(status).migrations).toEqual([]);
    for (const priorReviewedUpgrades of [
      [...beforeQuality, { ...quality, sourceSchemaSha256: 'f'.repeat(64) }],
      [...beforeQuality, quality, quality],
      [...beforeQuality, { ...quality, migrationCount: 24 }],
    ]) expect(() => assertMigrationCatalogue({ ...catalogue, compatibility: { ...catalogue.compatibility, priorReviewedUpgrades } }))
      .toThrow(/reviewed-upgrade metadata/);
    for (const change of [{ migration_sha256: 'f'.repeat(64) }, { contract_set_id: quality.contractSetId }]) {
      const rows = generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index));
      rows[rows.length - 1] = { ...rows.at(-1)!, ...change };
      expect(() => deriveMigrationStatus(rows, catalogue)).toThrow(DatabaseMigrationError);
    }
  });

  it('preserves the exact thirty-four-row predecessor while planning its legacy CHECK ACL suffix', () => {
    expect(() => assertMigrationCatalogue(generatedMigrationCatalogue)).not.toThrow();
    const prior = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.at(-1)!;
    expect(prior.migrationCount).toBe(34);
    const prefix = deriveMigrationStatus(generatedMigrationCatalogue.migrations.slice(0,34).map((_,index)=>ledgerRow(index)),generatedMigrationCatalogue);
    expect(prefix.pending.map(m=>m.id)).toEqual(['0035_intake_legacy_check_acl_v1_25', '0036_intake_sop_v1_26', '0037_menokin_source_registration', '0038_menokin_sop_domain_v1_27', '0039_menokin_sop_stage_media', '0040_intake_repair_successor_v1_28', '0041_intake_readiness_v1_29', '0042_intake_occupied_domain_publish', '0043_intake_publish_default_tenant', '0044_intake_role_defaults', '0045_feishu_agent_admit', '0046_project_feishu_roster', '0047_roster_query_signer', '0048_roster_store_set', '0049_roster_lifecycle', '0050_authorization_sources', '0051_publish_source_set', '0052_import_source_set', '0053_search_source_set', '0054_legacy_batch_owner_only', '0055_grant_steward_required', '0056_cancel_import_owner_only', '0057_role_ceiling', '0058_grant_steward_no_restore', '0059_query_grant_restamp', '0060_grant_issuer_authority', '0061_sop_entry_code_identity', '0062_store_set_authority_retention', '0063_store_set_keep_members_boundary', '0064_roster_query_requires_reader', '0065_legacy_orphan_fk_not_valid', '0066_policy_version_restamp', '0067_inaccuracy_outcome', '0068_seat_lifecycle', '0069_feishu_login_link', '0070_analytics_question_v1', '0071_analytics_runtime_execute', '0072_seat_post_grants', '0073_feishu_query_grant', '0074_authorization_deadline_engineer', '0075_authorization_deadline_source_null', '0076_authorization_decision', '0077_manual_identity_grants']);
    for (const change of [{ sourceSchemaSha256: 'f'.repeat(64) }, { contractSetId: generatedMigrationCatalogue.contractSetId }, { migrationCount: generatedMigrationCatalogue.migrations.length + 1 }]) {
      const invalid = { ...generatedMigrationCatalogue, compatibility: { ...generatedMigrationCatalogue.compatibility,
        priorReviewedUpgrades: [...generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, -1), { ...prior, ...change }] } };
      expect(() => assertMigrationCatalogue(invalid)).toThrow(/reviewed-upgrade metadata|provenance changes/);
    }
  });

  it('plans only the missing suffix for partial and complete ledgers', () => {
    const partial = deriveMigrationStatus([ledgerRow(0), ledgerRow(1)], generatedMigrationCatalogue);
    expect(partial.state).toBe('PARTIAL');
    expect(partial.pending[0]?.id).toBe('0003_events_and_metrics');
    expect(planMigrationCatalogue(partial).migrations).toHaveLength(generatedMigrationCatalogue.migrations.length - 2);

    const complete = deriveMigrationStatus(
      generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index)),
      generatedMigrationCatalogue,
    );
    expect(complete.state).toBe('COMPLETE');
    expect(planMigrationCatalogue(complete).migrations).toEqual([]);
    expect(complete.compatibility.priorUpgrade).toBe(
      'SUPPORTED · immutable 9-migration baseline → 68-migration current suffix',
    );
  });

  it('keeps the applied 0042 checksum and rejects a rewritten occupied-domain ledger or catalogue', () => {
    const frozen = 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37';
    const rewritten = '245e31b1993edc5017da5006f9f2e31062604d29c1189892fd8908d761d298fd';
    expect(generatedMigrationCatalogue.migrations).toHaveLength(77);
    expect(generatedMigrationCatalogue.migrations[41]).toMatchObject({
      id: '0042_intake_occupied_domain_publish',
      sha256: frozen,
    });
    expect(generatedMigrationCatalogue.migrations[42]?.id).toBe('0043_intake_publish_default_tenant');
    expect(generatedMigrationCatalogue.migrations[43]?.id).toBe('0044_intake_role_defaults');
    expect(generatedMigrationCatalogue.migrations[44]?.id).toBe('0045_feishu_agent_admit');
    expect(generatedMigrationCatalogue.migrations[45]?.id).toBe('0046_project_feishu_roster');
    expect(generatedMigrationCatalogue.migrations[46]?.id).toBe('0047_roster_query_signer');
    expect(generatedMigrationCatalogue.migrations[47]?.id).toBe('0048_roster_store_set');
    expect(generatedMigrationCatalogue.migrations[48]?.id).toBe('0049_roster_lifecycle');
    expect(generatedMigrationCatalogue.migrations[49]?.id).toBe('0050_authorization_sources');
    expect(generatedMigrationCatalogue.migrations[50]?.id).toBe('0051_publish_source_set');
    expect(generatedMigrationCatalogue.migrations[51]?.id).toBe('0052_import_source_set');
    expect(generatedMigrationCatalogue.migrations[52]?.id).toBe('0053_search_source_set');
    expect(generatedMigrationCatalogue.migrations[53]?.id).toBe('0054_legacy_batch_owner_only');
    expect(generatedMigrationCatalogue.migrations[54]?.id).toBe('0055_grant_steward_required');
    expect(generatedMigrationCatalogue.migrations[55]?.id).toBe('0056_cancel_import_owner_only');
    expect(generatedMigrationCatalogue.migrations[56]?.id).toBe('0057_role_ceiling');
    const rows = generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index));
    expect(deriveMigrationStatus(rows, generatedMigrationCatalogue).state).toBe('COMPLETE');
    const driftedLedger = rows.map((row, index) => index === 41 ? { ...row, migration_sha256: rewritten } : row);
    expect(() => deriveMigrationStatus(driftedLedger, generatedMigrationCatalogue)).toThrowError(
      expect.objectContaining<Partial<DatabaseMigrationError>>({ code: 'MIGRATION_LEDGER_DRIFT' }),
    );
    const occupied = generatedMigrationCatalogue.migrations[41];
    if (!occupied) throw new Error('missing occupied-domain migration');
    const sql = `${occupied.sql}\n-- drifted`;
    const driftedCatalogue = {
      ...generatedMigrationCatalogue,
      migrations: generatedMigrationCatalogue.migrations.map((migration, index) => index === 41
        ? { ...migration, sql, sha256: createHash('sha256').update(sql).digest('hex'), bytes: Buffer.byteLength(sql) }
        : migration),
    };
    expect(() => assertMigrationCatalogue(driftedCatalogue)).toThrow(/Frozen occupied-domain migration 0042 drifted/);
  });

  it('rejects an interrupted successor suffix', () => {
    const migrations = generatedMigrationCatalogue.migrations.map((migration, index) => (
      index === 47 ? { ...migration, id: '0048_roster_store_set_gap' } : migration
    ));
    expect(() => assertMigrationCatalogue({ ...generatedMigrationCatalogue, migrations })).toThrow(
      /Migration catalogue successor suffix is interrupted at 0048_roster_store_set_gap/,
    );
  });

  it('accepts the exact v1.12 ledger prefix and plans only the reviewed v1.13/v1.14 suffix', () => {
    const prior = generatedMigrationCatalogue.compatibility.priorSignedBaseline;
    if (!prior) throw new Error('generated catalogue must declare the v1.12 baseline');
    const baselineRows = generatedMigrationCatalogue.migrations
      .slice(0, prior.migrationCount)
      .map((_, index) => ledgerRow(index));
    const status = deriveMigrationStatus(baselineRows, generatedMigrationCatalogue);

    expect(status.state).toBe('PARTIAL');
    expect(status.pending.map(({ id }) => id)).toEqual([
      '0010_search_projection_v1_13',
      '0011_search_no_hit_context_v1_14',
      '0012_owner_acceptance_v1_15',
        '0013_backend_identity_content_v1_16',
      '0014_release_deferred_guard_v1_17',
      '0015_ops_loop_v1_18',
      '0016_office_owner_publish',
      '0017_rollback_previous_target',
      '0018_owner_read_views',
      '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication', '0033_intake_runtime_v1_23', '0034_intake_csv_v1_24', '0035_intake_legacy_check_acl_v1_25', '0036_intake_sop_v1_26', '0037_menokin_source_registration', '0038_menokin_sop_domain_v1_27', '0039_menokin_sop_stage_media', '0040_intake_repair_successor_v1_28', '0041_intake_readiness_v1_29', '0042_intake_occupied_domain_publish', '0043_intake_publish_default_tenant', '0044_intake_role_defaults', '0045_feishu_agent_admit', '0046_project_feishu_roster', '0047_roster_query_signer', '0048_roster_store_set', '0049_roster_lifecycle', '0050_authorization_sources', '0051_publish_source_set', '0052_import_source_set', '0053_search_source_set', '0054_legacy_batch_owner_only', '0055_grant_steward_required', '0056_cancel_import_owner_only', '0057_role_ceiling', '0058_grant_steward_no_restore', '0059_query_grant_restamp', '0060_grant_issuer_authority', '0061_sop_entry_code_identity', '0062_store_set_authority_retention', '0063_store_set_keep_members_boundary', '0064_roster_query_requires_reader', '0065_legacy_orphan_fk_not_valid', '0066_policy_version_restamp', '0067_inaccuracy_outcome', '0068_seat_lifecycle', '0069_feishu_login_link', '0070_analytics_question_v1', '0071_analytics_runtime_execute', '0072_seat_post_grants', '0073_feishu_query_grant', '0074_authorization_deadline_engineer', '0075_authorization_deadline_source_null', '0076_authorization_decision', '0077_manual_identity_grants',
    ]);
    expect(status.applied.every(({ contractSetId }) => contractSetId.includes('schema-1.12-'))).toBe(true);
  });

  it.each([
    ['gap', [ledgerRow(1)]],
    ['unknown', [...generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index)), { ...ledgerRow(0), position: 10, migration_id: '0010_unknown' }]],
    ['checksum', [{ ...ledgerRow(0), migration_sha256: '0'.repeat(64) }]],
    ['provenance', [{ ...ledgerRow(0), source_git_sha: '0'.repeat(40) }]],
  ])('fails closed for %s ledger drift', (_label, rows) => {
    expect(() => deriveMigrationStatus(rows, generatedMigrationCatalogue)).toThrowError(
      expect.objectContaining<Partial<DatabaseMigrationError>>({ code: 'MIGRATION_LEDGER_DRIFT' }),
    );
  });

  it('rejects an in-memory catalogue whose SQL no longer matches its checksum', () => {
    const first = generatedMigrationCatalogue.migrations[0];
    if (!first) throw new Error('missing first migration');
    const sql = `${first.sql}\n-- tampered`;
    const catalogue = {
      ...generatedMigrationCatalogue,
      migrations: [{ ...first, sql, sha256: createHash('sha256').update(first.sql).digest('hex') }],
    } as ExecutableMigrationCatalogue;
    expect(() => assertMigrationCatalogue(catalogue)).toThrowError(
      expect.objectContaining<Partial<DatabaseMigrationError>>({ code: 'MIGRATION_CATALOGUE_INVALID' }),
    );
  });

  it('normalizes status-query failures without echoing connection details', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('SENSITIVE_CONNECTION_DETAIL_DO_NOT_ECHO'), {
          code: '08006',
          detail: 'CONNECTION_FAILURE',
        });
      },
    } as unknown as DatabaseQueryClient;

    await expect(inspectMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_STATUS_FAILED',
      databaseCode: '08006',
      databaseDetail: 'CONNECTION_FAILURE',
      message: 'Database migration status could not be read safely',
    });
  });

  it('rejects non-PostgreSQL-15 servers before reading or adopting a ledger', async () => {
    const client = {
      query: async () => ({ rows: [{ server_version_num: 160_000 }] }),
    } as unknown as DatabaseQueryClient;

    await expect(inspectMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_SERVER_UNSUPPORTED',
      message: 'PostgreSQL 15 is required; server reports major 16',
    });
  });

  it('projects a fresh catalogue to public metadata without executable SQL', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("current_setting('server_version_num')")) {
          return { rows: [{ server_version_num: 150_018 }] };
        }
        if (sql.startsWith("SELECT to_regclass('customer_agent_meta.schema_migrations')")) {
          return { rows: [{ ledger: null }] };
        }
        if (sql.includes('AS dirty')) return { rows: [{ dirty: false }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as DatabaseQueryClient;

    const status = await inspectMigrationCatalogue(client, generatedMigrationCatalogue);
    expect(status.state).toBe('FRESH');
    expect(status.pending).toHaveLength(77);
    expect(status.pending.every((migration) => !('sql' in migration))).toBe(true);
  });
});
