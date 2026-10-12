import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { IntakePool } from './transaction.js';

export type IntakePurpose = 'usage' | 'business' | 'worker' | 'organization';
const capabilities: Readonly<Record<IntakePurpose, string>> = Object.freeze({
  usage: 'intake_usage', business: 'intake_business', worker: 'intake_worker', organization: 'intake_org_writer',
});
export type IntakePurposePool = IntakePool & { end(): Promise<void>; readonly totalCount: number };

/** Owns one explicitly configured environment LOGIN pool. No application configuration loading,
 * HTTP registration, role creation, or per-user authorization is performed here.
 * Every checkout must enter its sole NOLOGIN capability and pass the versioned
 * purpose guard before a caller receives the connection. Failed admission destroys
 * the connection. end() drains borrowed clients; it does not roll back their work. */
export function createIntakePurposePool(config: PoolConfig, purpose: IntakePurpose, report: (error: unknown) => void = () => undefined): IntakePurposePool {
  if (!Object.hasOwn(capabilities, purpose)) throw new Error('INTAKE_PURPOSE_INVALID');
  const raw = new Pool(config);
  // pg-pool has already evicted an idle failed client. Consume its error event
  // here because callers do not own the raw pool and cannot attach a listener.
  raw.on('error', error => { try { report(error); } catch { /* Diagnostics never own pool liveness. */ } });
  let ending: Promise<void> | undefined;
  return {
    async connect(): Promise<PoolClient> {
      if (ending) throw new Error('INTAKE_POOL_CLOSED');
      const client = await raw.connect();
      try {
        if (ending) throw new Error('INTAKE_POOL_CLOSED');
        // The role identifier is a closed source-owned mapping, never caller SQL.
        await client.query(`SET ROLE ${capabilities[purpose]}`);
        await client.query('SELECT intake_runtime.assert_purpose($1)', [purpose]);
        if (ending) throw new Error('INTAKE_POOL_CLOSED');
        return client;
      } catch (error) { client.release(true); throw error; }
    },
    end() { return ending ??= raw.end(); },
    get totalCount() { return raw.totalCount; },
  };
}
