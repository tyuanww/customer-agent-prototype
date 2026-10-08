import type { PoolClient } from 'pg';
import { parseContractSchema } from '@customer-agent/contracts';
import { canonical, digest } from '../../src/content-intake/material.js';
import { clock, type IntakePool } from '../../src/content-intake/transaction.js';

type Snapshot = {
  principalId: string; expectedFactsVersion: number; departmentIds: string[];
  jobId: string; enabled: boolean; checkedAt: string; validUntil: string;
};
type Failure = 'INVALID_INPUT' | 'SUBJECT_UNAVAILABLE' | 'VERSION_CONFLICT' | 'STALE_OBSERVATION' | 'DEPENDENCY_UNAVAILABLE';
export type RefreshResult = { ok: true; status: 'applied' | 'replayed'; factsVersion: number; currentFactsVersion: number }
  | { ok: false; reason: Failure; commit: 'rolled_back' | 'unknown' };
class Rejected extends Error { constructor(readonly reason: Failure) { super(reason); } }

function snapshot(raw: unknown): Snapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Rejected('INVALID_INPUT');
  const r = raw as Record<string, unknown>;
  const keys = ['principalId','expectedFactsVersion','departmentIds','jobId','enabled','checkedAt','validUntil'];
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r,k))) throw new Rejected('INVALID_INPUT');
  const id = (v: unknown) => parseContractSchema('IntakeId',v);
  if (!Number.isSafeInteger(r.expectedFactsVersion) || (r.expectedFactsVersion as number)<1
    || (r.expectedFactsVersion as number)>=Number.MAX_SAFE_INTEGER || typeof r.enabled!=='boolean'
    || !Array.isArray(r.departmentIds) || r.departmentIds.length<1 || r.departmentIds.length>100) throw new Rejected('INVALID_INPUT');
  const departmentIds = r.departmentIds.map(id).sort();
  if (new Set(departmentIds).size!==departmentIds.length) throw new Rejected('INVALID_INPUT');
  for (const field of ['checkedAt','validUntil'] as const) {
    const value=r[field];
    if (typeof value!=='string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString()!==value) throw new Rejected('INVALID_INPUT');
  }
  const checkedAt=r.checkedAt as string, validUntil=r.validUntil as string;
  if (Date.parse(validUntil)<=Date.parse(checkedAt) || Date.parse(validUntil)>Date.parse(checkedAt)+300_000) throw new Rejected('INVALID_INPUT');
  return { principalId:id(r.principalId),expectedFactsVersion:r.expectedFactsVersion as number,
    departmentIds,jobId:id(r.jobId),enabled:r.enabled,checkedAt,validUntil };
}

/** Offline experiment, excluded from API dist and HTTP registration. The caller is
 * a trusted organization observer, not a logged-in actor. This accepts only an
 * already registered principal, never creates identity/roles/grants, and cannot
 * authenticate a native provider's timestamps or detect stale upstream caches.
 * checkedAt is the trusted observation START; retries must keep the exact snapshot
 * and expected version. The immutable next facts version is the recovery key.
 * A replay acknowledges history only; current authority is always read separately.
 */
export function createOrganizationFactsWriter(pool: IntakePool, scope: { tenantId: string; appId: string },
  report: (error: unknown) => void = () => undefined) {
  const tenantId=parseContractSchema('IntakeId',scope.tenantId), appId=parseContractSchema('IntakeId',scope.appId);
  return async (raw: unknown): Promise<RefreshResult> => {
    let input: Snapshot;
    try { input=snapshot(raw); } catch { return { ok:false,reason:'INVALID_INPUT',commit:'rolled_back' }; }
    const version=input.expectedFactsVersion+1;
    const hash=digest(canonical({ tenantId,appId,...input }));
    let client: PoolClient | undefined, committing=false, broken=false;
    try {
      client=await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      const rows=await client.query<{current_facts_version:string; department_ids:string[]; job_id:string; enabled:boolean; checked_at:Date}>(`
        SELECT p.current_facts_version,f.department_ids,f.job_id,f.enabled,f.checked_at
        FROM content_intake.principals p JOIN content_intake.principal_facts f
          ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        WHERE p.principal_id=$1 AND p.tenant_id=$2 AND p.app_id=$3 FOR UPDATE OF p`,[input.principalId,tenantId,appId]);
      const current=rows.rows[0];
      if (!current) throw new Rejected('SUBJECT_UNAVAILABLE');
      const currentVersion=Number(current.current_facts_version);
      const prior=await client.query<{facts_digest:string}>(
        'SELECT facts_digest FROM content_intake.principal_facts WHERE principal_id=$1 AND facts_version=$2',[input.principalId,version]);
      if (prior.rows.length) {
        if (prior.rows[0]!.facts_digest!==hash) throw new Rejected('VERSION_CONFLICT');
        committing=true; await client.query('COMMIT');
        return {ok:true,status:'replayed',factsVersion:version,currentFactsVersion:currentVersion};
      }
      if (currentVersion!==input.expectedFactsVersion) throw new Rejected('VERSION_CONFLICT');
      const now=await clock(client);
      if (Date.parse(input.checkedAt)<=current.checked_at.getTime() || Date.parse(input.checkedAt)>now
        || Date.parse(input.validUntil)<=now) throw new Rejected('STALE_OBSERVATION');
      const changed=current.enabled!==input.enabled || current.job_id!==input.jobId
        || canonical([...current.department_ids].sort())!==canonical(input.departmentIds);
      await client.query(`INSERT INTO content_intake.principal_facts
        (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.principalId,version,input.departmentIds,input.jobId,input.enabled,input.checkedAt,input.validUntil,hash]);
      await client.query(`UPDATE content_intake.principals SET current_facts_version=$2,
        revocation_generation=revocation_generation+$3 WHERE principal_id=$1`,[input.principalId,version,changed?1:0]);
      if (await clock(client)>=Date.parse(input.validUntil)) throw new Rejected('STALE_OBSERVATION');
      committing=true; await client.query('COMMIT');
      return {ok:true,status:'applied',factsVersion:version,currentFactsVersion:version};
    } catch(error) {
      broken=committing;
      if (client && !committing) try { await client.query('ROLLBACK'); } catch { broken=true; }
      if (!(error instanceof Rejected)) {
        try { report(error); } catch { /* Diagnostics cannot turn an unknown commit into a claimed rollback. */ }
      }
      return {ok:false,reason:error instanceof Rejected?error.reason:'DEPENDENCY_UNAVAILABLE',commit:committing?'unknown':'rolled_back'};
    } finally { client?.release(broken); }
  };
}
