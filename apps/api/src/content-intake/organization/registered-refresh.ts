import { parseContractSchema } from '@customer-agent/contracts';
import type { PoolClient } from 'pg';
import { canonical, digest } from '../material.js';
import { clock, type IntakePool } from '../transaction.js';
import { createFeishuOrganizationObserver, type OrganizationTransport } from './feishu-observer.js';
import { createOrganizationFactsWriter, OrganizationFactsRejected, type OrganizationFactsSnapshot } from './facts-writer.js';

type Scope = { tenantId: string; appId: string };
type Binding = Scope & { principalId: string; openId: string; bindingVersion: number; enabled: boolean; validUntil: string; bindingDigest: string };
type Provenance = { mappingVersion: 'feishu-contact-job-title-v1'; directoryDigest: string; observedUntil: string };
export type RegisteredObservation = { kind: 'observation'; binding: Binding; snapshot: OrganizationFactsSnapshot; provenance: Provenance }
  | { kind: 'revocation'; binding: Binding; snapshot: OrganizationFactsSnapshot };
const rejected = () => new OrganizationFactsRejected('SUBJECT_UNAVAILABLE');
const conflict = () => new OrganizationFactsRejected('VERSION_CONFLICT');
const id = (value: unknown) => parseContractSchema('IntakeId', value);
function iso(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw rejected();
  return value;
}
function bindingDigest(binding: Omit<Binding, 'bindingDigest'>) { return digest(canonical(binding)); }
function checkedBinding(raw: Binding): Binding {
  if (!raw || Object.keys(raw).sort().join() !== ['tenantId','appId','principalId','openId','bindingVersion','enabled','validUntil','bindingDigest'].sort().join()
    || !Number.isSafeInteger(raw.bindingVersion) || raw.bindingVersion < 1 || typeof raw.enabled !== 'boolean') throw rejected();
  const base = { tenantId: id(raw.tenantId), appId: id(raw.appId), principalId: id(raw.principalId), openId: id(raw.openId),
    bindingVersion: raw.bindingVersion, enabled: raw.enabled, validUntil: iso(raw.validUntil) };
  if (raw.bindingDigest !== bindingDigest(base)) throw conflict();
  return { ...base, bindingDigest: raw.bindingDigest };
}

/** Versioned registration/provenance attachment. Registered rows are the only source
 * of open_id; a refresh caller supplies only a principal ID. Rebinding an active
 * registration is forbidden: revoke (including fact invalidation), then register.
 * A scan follows the whole job-title catalog up to the observer page budget.
 * Job-title reads wait out the published per-minute limit and retry.
 */
export function createRegisteredOrganizationRefresh(pool: IntakePool, rawScope: Scope, transport: OrganizationTransport) {
  const scope = { tenantId: id(rawScope.tenantId), appId: id(rawScope.appId) };
  const keys = (principalId: string) => [scope.tenantId, scope.appId, principalId];
  async function current(client: PoolClient, principalId: string): Promise<Binding | undefined> {
    const result = await client.query(`SELECT b.* FROM intake_organization.current_bindings c
      JOIN intake_organization.bindings b USING(tenant_id,app_id,principal_id,binding_version)
      WHERE c.tenant_id=$1 AND c.app_id=$2 AND c.principal_id=$3`, keys(principalId));
    const row = result.rows[0];
    return row ? checkedBinding({ ...scope, principalId, openId: row.open_id, bindingVersion: Number(row.binding_version),
      enabled: row.enabled, validUntil: row.valid_until.toISOString(), bindingDigest: row.binding_digest }) : undefined;
  }
  async function insertBinding(client: PoolClient, value: Binding) {
    await client.query(`INSERT INTO intake_organization.bindings VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [...keys(value.principalId), value.bindingVersion, value.bindingDigest, value.openId, value.enabled, value.validUntil]);
    await client.query(`INSERT INTO intake_organization.current_bindings VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,app_id,principal_id) DO UPDATE SET binding_version=EXCLUDED.binding_version,open_id=EXCLUDED.open_id`,
    [...keys(value.principalId), value.bindingVersion, value.openId]);
  }
  async function read(principalId: string, allowExpired = false) {
    const client = await pool.connect();
    try {
      const binding = await current(client, id(principalId));
      const now = await clock(client);
      const result = await client.query(`SELECT p.current_facts_version,f.* FROM content_intake.principals p
        JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        WHERE p.principal_id=$1 AND p.tenant_id=$2 AND p.app_id=$3`, [principalId, scope.tenantId, scope.appId]);
      if (!binding?.enabled || (!allowExpired && Date.parse(binding.validUntil) <= now) || !result.rows[0]) throw rejected();
      return { binding, now, facts: result.rows[0] };
    } finally { client.release(); }
  }
  return {
    /** Trusted registrar only; no principal/role/grant creation. Exact immutable
     * binding/version is also the registration recovery key after a lost COMMIT. */
    async register(input: { principalId: string; openId: string; expectedBindingVersion: number; validUntil: string }) {
      const principalId = id(input.principalId), openId = id(input.openId), validUntil = iso(input.validUntil);
      const expectedBindingVersion = input.expectedBindingVersion;
      if (!Number.isSafeInteger(expectedBindingVersion) || expectedBindingVersion < 0 || expectedBindingVersion >= Number.MAX_SAFE_INTEGER) throw rejected();
      const base = { ...scope, principalId, openId, validUntil, enabled: true, bindingVersion: expectedBindingVersion + 1 };
      const next = { ...base, bindingDigest: bindingDigest(base) };
      const client = await pool.connect();
      let committing = false, broken = false;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
        await client.query('SELECT backend_review.lock_content()');
        const saved = await client.query('SELECT binding_digest FROM intake_organization.bindings WHERE tenant_id=$1 AND app_id=$2 AND principal_id=$3 AND binding_version=$4', [...keys(principalId), next.bindingVersion]);
        if (saved.rows[0]?.binding_digest === next.bindingDigest) {
          committing = true; await client.query('COMMIT'); return { ok: true as const, binding: next, status: 'replayed' };
        }
        if (saved.rows.length) throw conflict();
        const prior = await current(client, principalId);
        if ((prior?.bindingVersion ?? 0) !== expectedBindingVersion || prior?.enabled) throw conflict();
        const found = await client.query('SELECT 1 FROM content_intake.principals WHERE tenant_id=$1 AND app_id=$2 AND principal_id=$3', keys(principalId));
        if (!found.rows.length || Date.parse(validUntil) <= await clock(client)) throw rejected();
        await insertBinding(client, next);
        if (Date.parse(validUntil) <= await clock(client)) throw new OrganizationFactsRejected('STALE_OBSERVATION');
        committing = true; await client.query('COMMIT'); return { ok: true as const, binding: next, status: 'applied' };
      } catch (error) {
        broken = committing;
        if (!committing) try { await client.query('ROLLBACK'); } catch { broken = true; }
        if (broken) return { ok: false as const, reason: 'DEPENDENCY_UNAVAILABLE' as const, commit: 'unknown' as const };
        return { ok: false as const, reason: error instanceof OrganizationFactsRejected ? error.reason : 'DEPENDENCY_UNAVAILABLE', commit: 'rolled_back' as const };
      } finally { client.release(broken); }
    },
    async observe(principalId: string, signal?: AbortSignal): Promise<RegisteredObservation> {
      const { binding, facts } = await read(principalId);
      const now = async () => { const client = await pool.connect(); try { return await clock(client); } finally { client.release(); } };
      const result = await createFeishuOrganizationObserver(scope, transport, now)({ ...scope, principalId,
        openId: binding.openId, expectedFactsVersion: Number(facts.current_facts_version) }, signal);
      if (!result.ok) throw new Error(result.reason);
      // The registration must outlive the complete fact lease. Never extend it.
      if (Date.parse(binding.validUntil) < Date.parse(result.snapshot.validUntil)) throw rejected();
      return { kind: 'observation', binding, snapshot: result.snapshot, provenance: result.provenance };
    },
    async prepareRevocation(principalId: string): Promise<RegisteredObservation> {
      const { binding, now, facts } = await read(principalId, true);
      return { kind: 'revocation', binding, snapshot: { principalId, expectedFactsVersion: Number(facts.current_facts_version),
        departmentIds: facts.department_ids, jobId: facts.job_id, enabled: false,
        checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 300_000).toISOString() } };
    },
    async write(raw: RegisteredObservation) {
      let request: RegisteredObservation;
      try {
        // Freeze before any async work so mutation cannot change receipt linkage.
        request = JSON.parse(JSON.stringify(raw)) as RegisteredObservation;
        if (Object.keys(request).sort().join() !== (request.kind === 'observation' ? ['kind','binding','snapshot','provenance'] : ['kind','binding','snapshot']).sort().join()) throw rejected();
        const binding = checkedBinding(request.binding);
        if (binding.tenantId !== scope.tenantId || binding.appId !== scope.appId || binding.principalId !== request.snapshot.principalId
          || !binding.enabled || !['observation','revocation'].includes(request.kind)) throw rejected();
        if (request.kind === 'observation') {
          const p = request.provenance;
          if (!p || Object.keys(p).sort().join() !== ['mappingVersion','directoryDigest','observedUntil'].sort().join()
            || p.mappingVersion !== 'feishu-contact-job-title-v1' || !/^[0-9a-f]{64}$/.test(p.directoryDigest)
            || Date.parse(iso(p.observedUntil)) < Date.parse(request.snapshot.checkedAt)
            || Date.parse(p.observedUntil) >= Date.parse(request.snapshot.validUntil)) throw rejected();
        } else if (request.snapshot.enabled !== false || Object.hasOwn(request, 'provenance')) throw rejected();
      } catch { return { ok: false as const, reason: 'INVALID_INPUT', commit: 'rolled_back' }; }
      const requestDigest = digest(canonical(request));
      return createOrganizationFactsWriter(pool, scope, undefined, async (client, input, version, replay) => {
        if (replay) {
          const saved = await client.query('SELECT request_digest FROM intake_organization.observations WHERE principal_id=$1 AND facts_version=$2', [input.principalId, version]);
          if (saved.rows[0]?.request_digest !== requestDigest) throw conflict();
          return; // Receipt recovery acknowledges history; it never restores authority.
        }
        const binding = await current(client, input.principalId);
        if (!binding?.enabled || binding.bindingVersion !== request.binding.bindingVersion || binding.bindingDigest !== request.binding.bindingDigest) throw conflict();
        if (request.kind === 'observation' && (Date.parse(binding.validUntil) <= await clock(client)
          || Date.parse(binding.validUntil) < Date.parse(input.validUntil))) throw rejected();
        if (request.kind === 'revocation') {
          const base = { ...binding, bindingVersion: binding.bindingVersion + 1, enabled: false };
          const { bindingDigest: _old, ...fields } = base;
          await insertBinding(client, { ...fields, bindingDigest: bindingDigest(fields) });
        }
        const p = request.kind === 'observation' ? request.provenance : null;
        if (p && Date.parse(p.observedUntil) > await clock(client)) throw rejected();
        await client.query(`INSERT INTO intake_organization.observations VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [input.principalId, version, scope.tenantId, scope.appId, binding.bindingVersion, requestDigest,
            request.kind, p?.mappingVersion ?? null, p?.directoryDigest ?? null, p?.observedUntil ?? null]);
      })(request.snapshot);
    },
  };
}
