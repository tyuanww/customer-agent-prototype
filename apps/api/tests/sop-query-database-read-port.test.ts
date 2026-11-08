import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { createSopQueryDatabaseReadPort, SOP_QUERY_READ_SQL } from '../src/sop-query-database-read-port.js';
import { createSopQueryOperation } from '../src/sop-query-operation.js';

const actor: AuthenticatedUser = { user_id: 'usr_synthetic_agent_001', role: 'agent', auth_mode: 'feishu' };
const request = {
  sop_group: '过敏流程SOP',
  shop_id: 'menokin_shop_001',
  product_context: null,
  query_text: '顾客使用后出现过敏怎么办',
  context_generation: 'gen-001',
  request_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
};
const ready = {
  status: 'ready' as const,
  release_id: 'release-sop-001',
  lease_expires_at: '2026-11-08T12:00:00.000Z',
  result: {
    entry_node_id: 'menokin:allergy:1',
    nodes: [{ node_id: 'menokin:allergy:1', scenario_id: 'allergy', sequence: 1, kind: 'instruction' as const, terminal: false, source_ref: 'sheet:过敏流程SOP!A2' }],
    branches: [],
    messages: [{ message_id: 'msg-allergy-1', node_id: 'menokin:allergy:1', title: '先停手并确认', body: '请先停手，并确认具体反应。', risk_level: 'high' as const, copy_allowed: true }],
    media_refs: [],
  },
  reasons: [],
};

function input(session_token_hash: string | null = 'a'.repeat(64)) {
  return { actor, request, session_token_hash };
}

describe('candidate SOP query database read port', () => {
  it('fails closed without private product-session provenance', async () => {
    const client = { query: vi.fn() };
    const result = await createSopQueryDatabaseReadPort(client).read(input(null));
    expect(result).toEqual({ ok: false, code: 'SCOPE_DENIED' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('passes only server-derived identity and request fields to the candidate SQL function', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ value: ready }] }) };
    const result = await createSopQueryDatabaseReadPort(client).read(input());
    expect(result).toEqual(ready);
    expect(client.query).toHaveBeenCalledWith(SOP_QUERY_READ_SQL, [
      actor.user_id,
      'a'.repeat(64),
      request.sop_group,
      request.shop_id,
      null,
      null,
      request.query_text,
      request.context_generation,
      request.request_id,
    ]);
    const values = client.query.mock.calls[0]?.[1] as unknown[];
    expect(values).not.toContain('userId');
    expect(values).not.toContain('token');
  });

  it('rejects malformed database results before the operation can bind a request id', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ value: { ...ready, release_id: 42 } }] }) };
    const operation = createSopQueryOperation(createSopQueryDatabaseReadPort(client));
    const result = await operation.execute(input());
    expect(result).toEqual({ ok: false, code: 'SOP_UNAVAILABLE' });
  });

  it('normalizes known database safety failures without exposing database details', async () => {
    const client = { query: vi.fn().mockRejectedValue({ message: 'internal', detail: 'SOP_BLOCKED' }) };
    const result = await createSopQueryDatabaseReadPort(client).read(input());
    expect(result).toEqual({ ok: false, code: 'SOP_BLOCKED' });
  });
});
