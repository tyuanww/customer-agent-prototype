/**
 * Database bootstrap for the synthetic stack.
 *
 * Applies the frozen migrations (0001–0014, never rewritten) to the isolated
 * cluster, then seeds the minimum governed reference data the content chain
 * needs: authoritative source versions, the synthetic intent taxonomy, and the
 * seeded subject bindings plus capability bindings for the review roles.
 *
 * All of this is synthetic. No real Feishu identity, customer data or
 * production source is represented here.
 */
import { createHash } from 'node:crypto';
// Import the built package rather than `src/`, whose internal `./x.js` specifiers
// only resolve after compilation. `stack start` already requires a prior
// `pnpm build:services`.
import { applyDatabaseMigrations } from '../../packages/database/dist/index.js';
import { SYNTHETIC_CONTENT_CSV, SYNTHETIC_SOURCES } from './content.ts';
import { SYNTHETIC_IDENTITIES } from './profile.ts';
import { SEED_INTENT } from './seed.ts';

const CAPABILITIES: readonly (readonly [string, string])[] = Object.freeze([
  ['synthetic_coach', 'content_review_lead'],
  ['synthetic_owner', 'content_review_manager'],
  ['synthetic_quality', 'content_quality_reviewer'],
]);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** True once the frozen migrations have been applied to this database. */
export async function isMigrated(client): Promise<boolean> {
  try {
    const result = await client.query('SELECT 1 FROM customer_agent_meta.schema_migrations LIMIT 1');
    return result.rowCount !== null && result.rowCount > 0;
  } catch {
    return false;
  }
}

export async function applyMigrations(client): Promise<string> {
  const result = await applyDatabaseMigrations(client);
  return `migrations: ${String(result.applied?.length ?? 0)} applied`;
}

/**
 * Insert the reference data the governed chain requires. Every statement is
 * idempotent so `start` can run after a partial failure without duplicating
 * rows, and the stack never edits rows it did not create.
 */
export async function seedReferenceData(client): Promise<string> {
  const digest = sha256(SYNTHETIC_CONTENT_CSV);
  for (const source of SYNTHETIC_SOURCES) {
    await client.query(`
      INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
      ) VALUES ($1,$2,$3,'synthetic-stack-v1',$4,'canonical','ROLE-CONTENT-LEAD','EVD-STACK-SOURCE',
        'synthetic-owner', clock_timestamp() - interval '1 day', clock_timestamp() + interval '365 days')
      ON CONFLICT (source_version_id) DO NOTHING
    `, [source.source_version_id, source.source_ref, source.domain, digest]);
  }

  await client.query(`
    INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
    VALUES ($1,'EVD-STACK-TAXONOMY','synthetic-owner', clock_timestamp())
    ON CONFLICT (intent_taxonomy_version) DO NOTHING
  `, [SEED_INTENT.version]);
  await client.query(`
    INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version, intent_id, label, lifecycle)
    VALUES ($1,$2,'合成发货','active')
    ON CONFLICT (intent_taxonomy_version, intent_id) DO NOTHING
  `, [SEED_INTENT.version, SEED_INTENT.id]);

  for (const identity of SYNTHETIC_IDENTITIES) {
    await client.query(`
      INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ($1,'synthetic','synthetic-tenant',$1,$2,$3,true,$4)
      ON CONFLICT (binding_id) DO NOTHING
    `, [identity.bindingId, identity.userId, sha256(identity.bindingId), identity.role]);
  }
  for (const [bindingId, capability] of CAPABILITIES) {
    const identity = SYNTHETIC_IDENTITIES.find((candidate) => candidate.bindingId === bindingId);
    if (!identity) throw new Error(`Capability binding references an unknown synthetic identity: ${bindingId}`);
    await client.query(`
      INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
      VALUES ($1,$2,true,'EVD-STACK-CAP')
      ON CONFLICT (user_id, capability) DO NOTHING
    `, [identity.userId, capability]);
  }

  return `reference data: ${String(SYNTHETIC_SOURCES.length)} sources, ${String(SYNTHETIC_IDENTITIES.length)} identities`;
}

export async function bootstrapDatabase(client): Promise<readonly string[]> {
  const steps: string[] = [];
  if (!(await isMigrated(client))) steps.push(await applyMigrations(client));
  else steps.push('migrations: already applied');
  steps.push(await seedReferenceData(client));
  return Object.freeze(steps);
}
