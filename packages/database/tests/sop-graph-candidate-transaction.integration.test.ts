import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pg15Harness } from '../src/testkit/pg15-harness.js';

const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';
const mappingVersion = 'menokin-six-sheet-mapping-v1';
const sourceSha256 = 'c3416b2c779f97b52c3e4b17a38ea1670d13616e180a8d818d1b6b99df9829c4';
const candidate = (overrides: Record<string, unknown> = {}) => ({
  candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'sop-graph-1',
  mappingVersion, sourceSha256, structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64),
  snapshotHash: 'a'.repeat(64), state: 'snapshot-ready',
  snapshot: {
    contract: 'resume-v3-snapshot-candidate', snapshotVersion: 1, snapshotHash: 'a'.repeat(64), publishable: false,
    mappingVersion, sourceSha256, structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64),
  },
  evidence: {
    candidateId: 'menokin.sop.allergy', candidateVersion: 1, mappingVersion, sourceSha256,
    structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64),
    successorAccepted: true, businessReviewed: true, successorDigest: 'b'.repeat(64), businessReviewDigest: 'c'.repeat(64),
  },
  ...overrides,
});

type CandidateRequest = ReturnType<typeof candidate>;
type TransactionResult = Readonly<{ replayed: boolean; response: Readonly<{ candidateId: string; candidateVersion: number; snapshotHash: string }> }>;

function requestHash(request: CandidateRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

async function installTables(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE sop_graph_candidate_snapshots (
      candidate_id TEXT NOT NULL,
      candidate_version INTEGER NOT NULL CHECK (candidate_version > 0),
      mapping_version TEXT NOT NULL,
      source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
      structure_digest TEXT NOT NULL CHECK (structure_digest ~ '^[0-9a-f]{64}$'),
      openapi_digest TEXT NOT NULL CHECK (openapi_digest ~ '^[0-9a-f]{64}$'),
      ddl_digest TEXT NOT NULL CHECK (ddl_digest ~ '^[0-9a-f]{64}$'),
      migrations_digest TEXT NOT NULL CHECK (migrations_digest ~ '^[0-9a-f]{64}$'),
      snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
      state TEXT NOT NULL CHECK (state IN ('snapshot-ready')),
      snapshot JSONB NOT NULL,
      PRIMARY KEY (candidate_id, candidate_version)
    );
    CREATE TABLE sop_graph_candidate_evidence (
      candidate_id TEXT NOT NULL,
      candidate_version INTEGER NOT NULL,
      evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('successor', 'business')),
      mapping_version TEXT NOT NULL,
      evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
      source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
      PRIMARY KEY (candidate_id, candidate_version, evidence_kind),
      FOREIGN KEY (candidate_id, candidate_version) REFERENCES sop_graph_candidate_snapshots(candidate_id, candidate_version)
    );
    CREATE TABLE sop_graph_candidate_receipts (
      idempotency_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      candidate_id TEXT NOT NULL,
      candidate_version INTEGER NOT NULL,
      response JSONB NOT NULL
    );
  `);
}

async function commitCandidate(client: Client, request: CandidateRequest, options: { loseCommitResponse?: boolean } = {}): Promise<TransactionResult> {
  const hash = requestHash(request);
  let committed = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('sop_graph_candidate_transaction_test'))`);
    const prior = await client.query<{ request_hash: string; response: TransactionResult['response'] }>(
      'SELECT request_hash,response FROM sop_graph_candidate_receipts WHERE idempotency_key=$1 FOR UPDATE', [request.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
      await client.query('COMMIT'); committed = true;
      return { replayed: true, response: prior.rows[0].response };
    }
    const sourceFields = ['mappingVersion', 'sourceSha256', 'structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const;
    const snapshotBound = sourceFields.every((field) => request.snapshot[field] === request[field]);
    const evidenceBound = sourceFields.every((field) => request.evidence[field] === request[field]);
    if (!snapshotBound) throw new Error('SNAPSHOT_SOURCE_MISMATCH');
    if (request.snapshot.publishable !== false) throw new Error('SNAPSHOT_NOT_PUBLISHABLE');
    if (!evidenceBound || request.evidence.candidateId !== request.candidateId || request.evidence.candidateVersion !== request.candidateVersion) {
      throw new Error('EVIDENCE_MISMATCH');
    }
    if (request.evidence.successorAccepted !== true || request.evidence.businessReviewed !== true) throw new Error('EVIDENCE_INCOMPLETE');
    await client.query(`INSERT INTO sop_graph_candidate_snapshots(candidate_id,candidate_version,mapping_version,source_sha256,structure_digest,openapi_digest,ddl_digest,migrations_digest,snapshot_hash,state,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [request.candidateId, request.candidateVersion, request.mappingVersion, request.sourceSha256,
      request.structureDigest, request.openapiDigest, request.ddlDigest, request.migrationsDigest, request.snapshotHash, request.state, request.snapshot]);
    await client.query(`INSERT INTO sop_graph_candidate_evidence(candidate_id,candidate_version,evidence_kind,mapping_version,evidence_hash,source_sha256)
      VALUES($1,$2,'successor',$3,$4,$5),($1,$2,'business',$3,$6,$5)`,
    [request.candidateId, request.candidateVersion, request.mappingVersion, request.evidence.successorDigest, request.sourceSha256, request.evidence.businessReviewDigest]);
    const response = { candidateId: request.candidateId, candidateVersion: request.candidateVersion, snapshotHash: request.snapshotHash } as const;
    await client.query('INSERT INTO sop_graph_candidate_receipts(idempotency_key,request_hash,candidate_id,candidate_version,response) VALUES($1,$2,$3,$4,$5)',
      [request.idempotencyKey, hash, request.candidateId, request.candidateVersion, response]);
    await client.query('COMMIT'); committed = true;
    if (options.loseCommitResponse) throw new Error('LOST_COMMIT_RESPONSE');
    return { replayed: false, response };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!enabled).sequential('SOP graph candidate transaction on isolated PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;

  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const database = harness.createDatabase('sop_graph_candidate');
    client = await harness.connect(database.config);
    await installTables(client);
  }, 60_000);

  afterEach(async () => {
    await client?.end(); harness?.stop();
  }, 60_000);

  it('commits snapshot, evidence and receipt atomically', async () => {
    const result = await commitCandidate(client, candidate());
    expect(result).toMatchObject({ replayed: false, response: { candidateId: 'menokin.sop.allergy', candidateVersion: 1 } });
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_snapshots')).rows).toEqual([{ count: 1 }]);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_evidence')).rows).toEqual([{ count: 2 }]);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_receipts')).rows).toEqual([{ count: 1 }]);
    expect((await client.query('SELECT evidence_kind,evidence_hash FROM sop_graph_candidate_evidence ORDER BY evidence_kind')).rows).toEqual([
      { evidence_kind: 'business', evidence_hash: 'c'.repeat(64) },
      { evidence_kind: 'successor', evidence_hash: 'b'.repeat(64) },
    ]);
  });

  it('replays the same idempotency key and rejects a conflicting request', async () => {
    const first = await commitCandidate(client, candidate());
    const replay = await commitCandidate(client, candidate());
    expect(replay).toEqual({ replayed: true, response: first.response });
    await expect(commitCandidate(client, candidate({ snapshotHash: 'c'.repeat(64) }))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_snapshots')).rows).toEqual([{ count: 1 }]);
  });

  it('rolls back the snapshot when evidence does not match', async () => {
    await expect(commitCandidate(client, candidate({ evidence: { ...candidate().evidence, sourceSha256: 'd'.repeat(64) } }))).rejects.toThrow('EVIDENCE_MISMATCH');
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_snapshots')).rows).toEqual([{ count: 0 }]);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_evidence')).rows).toEqual([{ count: 0 }]);
  });

  it('rolls back when snapshot source binding drifts from the candidate', async () => {
    await expect(commitCandidate(client, candidate({ snapshot: { ...candidate().snapshot, ddlDigest: 'd'.repeat(64) } }))).rejects.toThrow('SNAPSHOT_SOURCE_MISMATCH');
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_snapshots')).rows).toEqual([{ count: 0 }]);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_evidence')).rows).toEqual([{ count: 0 }]);
  });

  it('rejects incomplete evidence and publishable snapshots before any insert', async () => {
    await expect(commitCandidate(client, candidate({ evidence: { ...candidate().evidence, businessReviewed: false } }))).rejects.toThrow('EVIDENCE_INCOMPLETE');
    await expect(commitCandidate(client, candidate({ snapshot: { ...candidate().snapshot, publishable: true } }))).rejects.toThrow('SNAPSHOT_NOT_PUBLISHABLE');
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_snapshots')).rows).toEqual([{ count: 0 }]);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_evidence')).rows).toEqual([{ count: 0 }]);
  });

  it('recovers an unknown commit through the durable receipt', async () => {
    const value = candidate();
    await expect(commitCandidate(client, value, { loseCommitResponse: true })).rejects.toThrow('LOST_COMMIT_RESPONSE');
    const replay = await commitCandidate(client, value);
    expect(replay.replayed).toBe(true);
    expect((await client.query('SELECT count(*)::int AS count FROM sop_graph_candidate_receipts')).rows).toEqual([{ count: 1 }]);
  });
});
