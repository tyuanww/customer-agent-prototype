import { describe, expect, it, vi } from 'vitest';
import { INTAKE_POLICY, SOP_RESOURCE_FORMAT, SOP_TASK_STRUCTURE_SHA256, TEMPLATE_VERSION } from '@customer-agent/content-intake';
import { createIntakeDiscovery } from '../src/content-intake/discovery.js';
import { withIntakeView } from '../src/content-intake/contract-view.js';
import { createIntakeTransactions, type IntakeTransaction, type Principal } from '../src/content-intake/transaction.js';

const now = Date.parse('2026-11-10T12:00:00Z');
const until = now + 300_000;
vi.mock('../src/content-intake/transaction.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/content-intake/transaction.js')>(),
  lockProductSession: async () => ({ hash: 'a'.repeat(64), validUntil: until }),
}));
const actor = { user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' } as const;
const principal: Principal = { id: 'synthetic-principal', userId: actor.user_id, tenantId: 'tenant-a', appId: 'app-a',
  identityScope: 'synthetic', personKey: 'synthetic-person', factsVersion: 1, generation: 1, enabled: true,
  checkedAt: now, validUntil: until, role: 'agent' };

function fixture(ruleVersion: string = INTAKE_POLICY.version) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const query = vi.fn().mockImplementation(async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes('WITH stamp AS MATERIALIZED')) return { rows: ['source-a', 'source-b'].map(sourceId => ({
      source: { scope: { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId },
        version: 1, templateVersion: TEMPLATE_VERSION, ruleVersion, mappingVersion: 'mapping-v1', structureDigest: 'b'.repeat(64),
        contentIntakeMode: 'v2-preview', modeVersion: 1 },
      rights: [{ action: 'query', kind: 'business', until: new Date(until).toISOString() }],
    })) };
    if (sql.includes('FROM content_intake.policy_versions')) return { rows: [{ version: '1' }] };
    if (sql === 'SELECT clock_timestamp() AS time') return { rows: [{ time: new Date(now) }] };
    throw new Error(`Unexpected discovery query ${sql}`);
  });
  const client: IntakeTransaction = { query, validUntil: () => undefined, beforeCommit: () => undefined };
  const run: ReturnType<typeof createIntakeTransactions> = async (_actor, _command, _request, _operation, work, decode) =>
    ({ ok: true, value: decode(await work(client, principal)) });
  return { service: createIntakeDiscovery(run), queries };
}

describe('discovery view boundary', () => {
  it.each(['legacy', 'graph', 'resource-disable'] as const)('binds the registered resource tuple before SQL paging for %s', async view => {
    const { service, queries } = fixture();
    await withIntakeView(view, () => service.sources(actor, { limit: 1 }));
    const statement = queries.find(item => item.sql.includes('WITH stamp AS MATERIALIZED'))!;
    expect(statement.values.slice(5)).toEqual([view !== 'legacy', view === 'resource-disable',
      SOP_RESOURCE_FORMAT.templateVersion, SOP_RESOURCE_FORMAT.ruleVersion, SOP_RESOURCE_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256]);
    expect(statement.sql.indexOf('IS DISTINCT FROM')).toBeGreaterThan(-1);
    expect(statement.sql.indexOf('IS DISTINCT FROM')).toBeLessThan(statement.sql.indexOf('ORDER BY src.source_id'));
  });

  it.each([['legacy', 'graph'], ['graph', 'resource-disable'], ['resource-disable', 'graph']] as const)(
    'rejects the same actor/session/projection cursor from %s in %s', async (origin, other) => {
      const { service } = fixture();
      const first = await withIntakeView(origin, () => service.sources(actor, { limit: 1 }));
      if (!first.ok || !first.value.nextCursor) throw new Error('Expected first source cursor');
      const cursor = first.value.nextCursor;
      const next = await withIntakeView(origin, () => service.sources(actor, { limit: 1, cursor }));
      expect(next.ok && next.value.items[0]?.scope.sourceId).toBe('source-b');
      await expect(withIntakeView(other, () => service.sources(actor, { limit: 1, cursor })))
        .rejects.toMatchObject({ reason: 'PERMISSION_CHANGED' });
    });

  it('still rejects an invalid remaining source instead of silently dropping it', async () => {
    const { service } = fixture('unregistered-rule');
    await expect(withIntakeView('graph', () => service.sources(actor, { limit: 1 })))
      .rejects.toThrow('Contract validation failed for IntakeSource');
  });
});
