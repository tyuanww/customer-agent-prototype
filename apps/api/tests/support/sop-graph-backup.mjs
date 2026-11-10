import { assertSopQueryGraph } from '../../dist/sop-unified-query-validation.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from 'pg';
import Fastify from 'fastify';
import { CONTRACT_PROVENANCE, parseContractSchema } from '@customer-agent/contracts/sop-unified';
import { createBackupSet, verifyBackupSet, extractObjectArchive, DATABASE_DUMP_FILE, OBJECTS_ARCHIVE_FILE } from '../../../../scripts/ops/backup-set.mjs';
import { verifyDatabaseMigrations } from '../../../../packages/database/dist/index.js';
import { createContentObjectStore } from '../../dist/content-object-store.js';
import { canonical, digest } from '../../dist/content-intake/material.js';
import { createProductAuthService } from '../../dist/product-auth-service.js';
import { createIntakePurposePool } from '../../dist/content-intake/runtime-pool.js';
import { createContentIntakeService } from '../../dist/content-intake/service.js';
import { generatedMigrationCatalogue } from '../../../../packages/database/dist/generated/migrations.generated.js';
import { registerSopQueryRoute } from '../../dist/sop-query-routes.js';
import { createUnifiedSopQueryOperation } from '../../dist/sop-unified-query-operation.js';
import { createSopContinuationService } from '../../dist/sop-continuation.js';
import { sopContinuationRoutes } from '../../dist/sop-continuation-routes.js';
import { contentIntakeUsageRoutes } from '../../dist/content-intake/usage-http.js';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.match(path.basename(realpathSync(input.root)), /^customer-agent-pg15-/);
assert.equal(realpathSync(input.host).startsWith(`${realpathSync(input.root)}/`), true);
assert.match(input.database, /^dev_m0_intake_desktop_[0-9a-f]{8}$/);
assert.match(input.user, /^[a-z_][a-z0-9_]*$/);
const evidenceRoot = realpathSync(input.evidenceRoot);
assert.equal(path.dirname(evidenceRoot), realpathSync(os.tmpdir()));
assert.match(path.basename(evidenceRoot), /^sop-unified-(?:lifecycle-evidence|query-http|continuation-http)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const pgBin = process.env.CUSTOMER_AGENT_PG15_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
const environment = { PATH: process.env.PATH, LC_ALL: 'C', PGCONNECT_TIMEOUT: '5' };
const original = new Client({ host: input.host, port: input.port, user: input.user, database: input.database });
const restoredName = `dev_m0_sop_restore_${randomBytes(4).toString('hex')}`;
let restored;
let app, auth, usagePool;
try {
  await original.connect();
  assert.equal((await original.query("SELECT inet_server_addr() IS NULL AS socket_only,current_setting('server_version_num')::int AS version")).rows[0].socket_only, true);
  const counts = async client => (await client.query(`SELECT
    (SELECT count(*)::int FROM content_intake.sop_graph_versions) candidates,
    (SELECT count(*)::int FROM content_intake.sop_graph_quality_targets) targets,
    (SELECT count(*)::int FROM content_intake.sop_graph_quality_checks) checks,
    (SELECT count(*)::int FROM content_intake.sop_graph_release_lineage) lineage,
    (SELECT count(*)::int FROM content_intake.sop_graph_release_media) media`)).rows[0];
  const before = await counts(original);
  for (const count of Object.values(before)) assert.ok(count > 0);
  const fidelity = async client => {
    const tables = ['sop_graph_versions', 'sop_graph_media_bindings', 'sop_graph_quality_targets', 'sop_graph_quality_checks',
      'sop_graph_release_lineage', 'sop_graph_release_media', 'sop_graph_disable_events', 'candidate_versions',
      'source_confirmations', 'quality_plans', 'quality_rounds', 'publications', 'sop_media_objects', 'objects', 'object_reservations',
      'sop_query_fact_versions','sop_unified_query_bindings','sop_query_previews','sop_query_leases',
      'entitlements','entitlement_contexts','entitlement_scopes','backend_review.receipts',
      ...(input.continuationProbe ? ['sop_active_uses','backend_identity.sessions','public.snapshot_offline_leases'] : [])];
    const result = {};
    for (const table of tables) {
      const rows = (await client.query(`SELECT to_jsonb(t) AS row FROM ${table.includes('.') ? table : `content_intake.${table}`} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows;
      result[table] = { count: rows.length, sha256: digest(canonical(rows)) };
    }
    return result;
  };
  const sourceFidelity = await fidelity(original);
  const backup = await createBackupSet({ stack: { stackRoot: input.root, profileFile: process.argv[2], databaseName: input.database,
    pgPort: input.port, pgSocketDirectory: input.host, pgUser: input.user, objectStoreDirectory: path.join(input.root, 'objects') },
  pgBin, backupRoot: path.join(input.evidenceRoot, 'nonempty-backup'), copyRoot: '' });
  const verified = await verifyBackupSet(backup.path, { pgBin });
  assert.equal(verified.manifest.database.migrations.length, generatedMigrationCatalogue.migrations.length);
  await original.query(`CREATE DATABASE ${restoredName} TEMPLATE template0 OWNER ${input.user}`);
  const args = ['--exit-on-error', '--host', input.host, '--port', String(input.port), '--username', input.user,
    '--dbname', restoredName, path.join(backup.path, DATABASE_DUMP_FILE)];
  writeFileSync(path.join(input.evidenceRoot, 'restore-command.json'), JSON.stringify({ binary: path.join(pgBin, 'pg_restore'), arguments: args }, null, 2));
  execFileSync(path.join(pgBin, 'pg_restore'), args, { env: environment, stdio: 'pipe', timeout: 120_000 });
  const objectRoot = path.join(input.root, 'restored-graph-objects');
  await extractObjectArchive(path.join(backup.path, OBJECTS_ARCHIVE_FILE), objectRoot, verified.manifest.objects);
  restored = new Client({ host: input.host, port: input.port, user: input.user, database: restoredName });
  await restored.connect();
  const report = await verifyDatabaseMigrations(restored);
  assert.equal(report.status, 'PASS'); assert.equal(report.migrationCount, generatedMigrationCatalogue.migrations.length);
  assert.deepEqual(await counts(restored), before);
  const restoredFidelity = await fidelity(restored);
  assert.deepEqual(restoredFidelity, sourceFidelity);
  assert.equal((await restored.query(`SELECT count(*)::int count FROM content_intake.sop_graph_release_lineage l
    LEFT JOIN content_intake.publications p ON p.candidate_id=l.candidate_id AND p.candidate_version=l.candidate_version
    WHERE p.candidate_id IS NULL`)).rows[0].count, 0);
  await restored.query('BEGIN; SET LOCAL ROLE intake_usage');
  const graph = (await restored.query('SELECT content_intake.read_sop_graph_current($1,$2) AS value', ['agent', input.entitlementHash])).rows[0].value;
  await restored.query('COMMIT');
  assert.deepEqual(graph.graphs.map(item => item.graphDigest), input.graphDigests);
  for (const item of graph.graphs) {
    const original = (await restored.query(`SELECT version.graph_payload FROM content_intake.sop_graph_release_lineage lineage
      JOIN content_intake.sop_graph_versions version USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
      WHERE lineage.release_id=$1 AND lineage.source_id=$2 AND lineage.flow_id=$3 AND lineage.graph_digest=$4`,
    [input.releaseId, item.payload.definition.header.key.sourceId, item.payload.definition.header.key.flowId, item.graphDigest])).rows[0]?.graph_payload;
    assert.ok(original);
    assertSopQueryGraph(original, item.graphDigest);
    assert.deepEqual(item.payload.definition, original.definition);
    assert.deepEqual(item.payload.entries, original.entries);
    const fullMedia = new Set(original.media.map(media => canonical(media)));
    assert.ok(item.payload.media.every(media => fullMedia.has(canonical(media))));
  }
  const objects = (await restored.query(`SELECT DISTINCT media.payload_object_id AS "objectId",media.sha256,media.bytes::int AS "sizeBytes",media.mime
    FROM content_intake.sop_graph_release_media binding JOIN content_intake.sop_media_objects media ON media.media_object_id=binding.object_id
    WHERE binding.release_id=$1`, [input.releaseId])).rows;
  assert.ok(objects.length > 0);
  const store = createContentObjectStore(objectRoot), consumed = [];
  for (const descriptor of objects) {
    const bytes = await store.readAttachment(descriptor);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, descriptor.sha256); assert.equal(input.imageSha256.includes(hash), true); assert.equal(bytes.length, descriptor.sizeBytes);
    consumed.push({ objectId: descriptor.objectId, sha256: hash, bytes: bytes.length });
  }
  assert.deepEqual(consumed.map(item => item.sha256).sort(), [...input.imageSha256].sort());
  auth = await createProductAuthService({ connectionString: `postgresql://stack_backend_auth@localhost/${restoredName}?${new URLSearchParams({ host: input.host, port: String(input.port) })}`,
    poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 }, {
    authorizeUrl: () => { throw new Error('Restore reads use only the restored synthetic session'); },
    exchange: async () => { throw new Error('Restore reads never exchange provider data'); }, close: () => undefined,
  }, 'mock');
  usagePool = createIntakePurposePool({ host: input.host, port: input.port, user: 'synthetic_usage', database: restoredName, max: 2 }, 'usage');
  app = Fastify();
  if (input.continuationProbe) await app.register(sopContinuationRoutes, { auth,
    continuation: createSopContinuationService(usagePool, undefined, store) });
  let http;
  if (input.query) {
    for (const table of ['sop_query_fact_versions','sop_unified_query_bindings','sop_query_previews','sop_query_leases']) assert.ok(sourceFidelity[table].count>0);
    registerSopQueryRoute(app, auth, { unifiedOperation: createUnifiedSopQueryOperation(usagePool, store) });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${origin}/v1/sop/query`, { method: 'POST', headers: { authorization: input.agentAuthorization,
      'X-Intake-Contract-Set': CONTRACT_PROVENANCE.contract_set_id, 'content-type': 'application/json' }, body: JSON.stringify(input.query.request) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body, input.query.response);
    assert.deepEqual(await fidelity(restored), restoredFidelity);
    http = { queryStatus: body.status, graphDigest: body.result.graph_digest, permissionCount: body.result.permissions.length,
      mediaCount: body.result.media.length, sameRequestRecovered: true };
  } else {
  const usage = createContentIntakeService(usagePool, store, undefined, undefined, { requireProductSession: true });
  await app.register(contentIntakeUsageRoutes, { auth, usage });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { authorization: input.agentAuthorization, 'X-Intake-Contract-Set': CONTRACT_PROVENANCE.contract_set_id };
  const response = await fetch(`${origin}/v1/intake/entitlements`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ shopId: 'shop-a', productIds: ['product-graph', 'product-solo'], scenarioIds: ['scenario-graph', 'scenario-solo'], contextGeneration: 999, releaseId: null }) });
  const entitlementBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(entitlementBody));
  const entitlement = parseContractSchema('IntakeEntitlement', entitlementBody);
  assert.equal(entitlement.releaseId, input.releaseId);
  const pages = [];
  let cursor = null;
  do {
    const snapshot = await fetch(`${origin}/v1/intake/snapshot?entitlementId=${entitlement.entitlementId}&limit=2${cursor ? `&cursor=${cursor}` : ''}`, { headers });
    const body = await snapshot.json();
    assert.equal(snapshot.status, 200, JSON.stringify(body));
    const page = parseContractSchema('IntakeSnapshot', body);
    assert.equal(page.pageIndex, pages.length);
    pages.push(page); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(pages.length, pages[0].pageCount);
  const projection = { releaseId: entitlement.releaseId, entitlementId: entitlement.entitlementId, contextGeneration: entitlement.contextGeneration };
  for (const name of ['faq', 'vocabulary', 'sopFlows', 'sopNodes', 'sopEdges', 'media']) {
    projection[name] = pages.flatMap(page => page[name]);
    assert.equal(projection[name].length, pages[0].totals[name]);
  }
  assert.equal(digest(canonical(projection)), pages[0].snapshotDigest);
  assert.deepEqual(projection.sopFlows.map(flow => flow.graphDigest), input.graphDigests);
  assert.equal(projection.media.length, 3);
    http = { pageCount: pages.length, totals: pages[0].totals, snapshotDigest: pages[0].snapshotDigest };
  }
  if (input.continuationProbe) {
    // Main-owned handles are supplied through stdin and excluded from persisted metadata.
    const probe = JSON.parse(readFileSync(0, 'utf8'));
    const origin = app.server.address();
    assert.ok(origin && typeof origin === 'object');
    const base = `http://127.0.0.1:${origin.port}`;
    const headers = { authorization: input.agentAuthorization, 'X-Intake-Contract-Set': CONTRACT_PROVENANCE.contract_set_id,
      'content-type': 'application/json' };
    const activeCount = (await restored.query('SELECT count(*)::int count FROM content_intake.sop_active_uses WHERE closed_at IS NULL')).rows[0].count;
    const closedCount = (await restored.query('SELECT count(*)::int count FROM content_intake.sop_active_uses WHERE closed_at IS NOT NULL AND session_hash IS NULL')).rows[0].count;
    const boundCount = (await restored.query('SELECT count(*)::int count FROM content_intake.entitlements WHERE sop_continuation_hash IS NOT NULL')).rows[0].count;
    assert.ok(activeCount > 0 && closedCount > 0 && boundCount > 0);
    const renewed = await fetch(`${base}/v1/intake/sop/continuations/renew`, { method: 'POST', headers,
      body: JSON.stringify({ continuationId: probe.active, contextGeneration: 909 }) });
    const renewedBody = await renewed.json();
    assert.equal(renewed.status, 200, JSON.stringify(renewedBody));
    const receipt = parseContractSchema('IntakeSopContinuationReceipt', renewedBody);
    assert.equal(receipt.entitlement.releaseId, probe.releaseId);
    const query = new URLSearchParams({ ...probe.binding, entitlementId: receipt.entitlement.entitlementId });
    const mediaResponse = await fetch(`${base}/v1/intake/sop/releases/${probe.releaseId}/media/${probe.objectId}?${query}`, {
      headers: { ...headers, 'X-Sop-Continuation': probe.active } });
    const mediaBody = await mediaResponse.json();
    assert.equal(mediaResponse.status, 200, JSON.stringify(mediaBody));
    const media = parseContractSchema('IntakeSopMediaPayload', mediaBody);
    const bytes = Buffer.from(media.base64, 'base64');
    assert.equal(digest(bytes), probe.sha256); assert.equal(bytes.length, media.bytes);
    const refused = await fetch(`${base}/v1/intake/sop/continuations/renew`, { method: 'POST', headers,
      body: JSON.stringify({ continuationId: probe.closed, contextGeneration: 910 }) });
    assert.equal(refused.status, 409);
    const denied = parseContractSchema('IntakeError', await refused.json());
    assert.equal(denied.error.details.reason, 'SOP_RELEASE_CHANGED');
    const repeated = await fetch(`${base}/v1/intake/sop/continuations/close`, { method: 'POST', headers,
      body: JSON.stringify({ continuationId: probe.closed }) });
    assert.equal(repeated.status, 204);
    const originalPublication = (await restored.query(`SELECT pub.release_id FROM content_intake.sop_graph_release_lineage l
      JOIN content_intake.publications pub ON pub.candidate_id=l.candidate_id AND pub.candidate_version=l.candidate_version
      WHERE l.release_id=$1 AND l.source_id=$2 AND l.flow_id=$3`, [probe.releaseId,probe.binding.sourceId,probe.binding.flowId])).rows[0];
    assert.ok(originalPublication);
    http.continuation = { activeCount, closedCount, boundCount, restoredRenew: true, originalPublication: originalPublication.release_id,
      historicalMedia: { bytes: bytes.length, sha256: digest(bytes), mime: media.mime }, closedRejected: true, repeatedClose: true };
  }
  const acl = (await restored.query(`SELECT p.oid::regprocedure::text AS function,owner.rolname AS owner,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE n.nspname='content_intake' AND p.proname IN ('freeze_sop_graph_candidate','check_sop_graph_quality','project_sop_graph_release','read_sop_graph_current') ORDER BY 1`)).rows;
  assert.equal(acl.length, 4);
  for (const fn of acl) { assert.equal(fn.owner, 'intake_runtime_fn_owner'); assert.equal(fn.public_exec, false); assert.equal(fn.prosecdef, true); assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']); }
  writeFileSync(path.join(input.evidenceRoot, 'nonempty-restore-results.json'), JSON.stringify({ status: 'SYNTHETIC_PASS', source: '812a2e80584f08675fab8b7401ce8b4cd3ab5bca',
    report, before, after: await counts(restored), sourceFidelity, restoredFidelity,
    releaseId: input.releaseId, graphDigests: input.graphDigests, consumed, acl, backup: backup.path,
    http }, null, 2));
  process.stdout.write('NONEMPTY_GRAPH_RESTORE_PASS\n');
} finally {
  await app?.close();
  await auth?.close();
  await usagePool?.end();
  await restored?.end();
  try { await original.query(`DROP DATABASE IF EXISTS ${restoredName}`); } finally { await original.end(); }
}
