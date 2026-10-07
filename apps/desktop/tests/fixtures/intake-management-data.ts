import type { components } from '@customer-agent/contracts';
type C = components['schemas'];
export function intakeManagementData(count = 2) {
  const key: C['IntakeCandidateKey'] = { candidateId: 'candidate-a', version: 1, digest: 'a'.repeat(64) };
  const scope: C['IntakeSourceScope'] = { sourceId: 'source-a', tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product' };
  const entry: C['IntakeEntry'] = { businessEntryId: 'faq-a', scriptVersion: 1, operation: 'upsert', title: '合成洁面', answerText: '第一行\n第二行', questions: [], productRefs: [], scenarioRefs: [], effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: null, applicabilityNote: '', familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false, category: '', internalNote: '合成内部说明', riskNote: '', attachmentNote: '' };
  const candidate: C['IntakeCandidate'] = { key, sourceId: scope.sourceId, state: 'awaiting-evidence', readinessReasons: ['AWAITING_APPROVAL'], sourceEvidenceVersion: 0, approvalEvidenceVersion: 0, revocationGeneration: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedReleaseId: null };
  const status: C['IntakeQualityStatus'] = { key, viewHash: 'b'.repeat(64), state: 'not_frozen', frozen: null, rounds: [], plan: { policyVersion: 'intake-quality-v1', ordinaryCount: count, mandatoryCount: 0, withdrawalCount: 0, initialTarget: count, expandedTarget: count, initialCount: count, expandedCount: count, seedHash: 'a'.repeat(64), populationManifestHash: 'b'.repeat(64), selectionManifestHash: 'c'.repeat(64) } };
  const samples: C['IntakeQualitySample'][] = Array.from({ length: count }, (_, i) => ({ scriptId: `intake_${i.toString(16).padStart(64,'0')}`, contentHash: 'c'.repeat(64), mandatory: false, check: null, entry: { ...entry, operation: 'upsert', businessEntryId: `faq-${i}`, title: `合成洁面 ${i + 1}` } }));
  const state = { allowed: true, reviewer: true, ttl: 60_000 };
  const receipts = new Map<string, C['IntakeQualityReceipt']>();
  let validUntil = new Date(Date.now()+state.ttl).toISOString();
  const respond = (path: string, body?: unknown): unknown => {
    const u = new URL(path, 'http://127.0.0.1');
    if (u.pathname.endsWith('/authorization')) return { factsVersion: 1, revocationGeneration: 0, policyVersion: 1, validUntil, nextCursor: null,
      capabilities: [{ scope, actions: state.allowed ? ['content-manage', ...(state.reviewer ? ['review'] : [])] : ['query'], mayAllocate: [], mayDelegate: [], validUntil }] };
    if (u.pathname.endsWith('/sources')) return { items: [{ scope, version: 1, templateVersion: 'faq-p1.1', ruleVersion: 'intake-p1.1', mappingVersion: 'mapping-p1.1', structureDigest: 'a'.repeat(64), contentIntakeMode: 'v2-preview', modeVersion: 1 }], nextCursor: null };
    if (!state.allowed) throw new Error('FORBIDDEN');
    if (u.pathname === '/v1/intake/candidates') return { items: [candidate], nextCursor: null };
    if (u.pathname.endsWith('/quality/freeze') || u.pathname.endsWith('/quality/checks')) {
      const req = body as C['IntakeQualitySubmission'];
      const action = u.pathname.endsWith('/freeze') ? 'quality-freeze' : 'quality-check';
      const existing = receipts.get(req.operationId); if (existing) return existing;
      status.state = action === 'quality-freeze' ? 'initial_required' : 'passed';
      status.frozen = { principalId: 'reviewer', factsVersion: 1, recordedAt: '2026-01-01T00:00:00Z' };
      if (action === 'quality-check') { for (const sample of samples) sample.check = req.checks.find(c => c.scriptId === sample.scriptId)!; }
      const receipt: C['IntakeQualityReceipt'] = { key, operationId: req.operationId, action, state: status.state, phase: action === 'quality-freeze' ? null : req.phase };
      receipts.set(req.operationId, receipt); return receipt;
    }
    if (u.pathname.includes('/quality/operations/')) { const r = receipts.get(u.pathname.split('/').at(-1)!); if (!r) throw new Error('NOT_FOUND'); return r; }
    if (u.pathname.endsWith('/quality/samples')) return { key, viewHash: status.viewHash, selectionManifestHash: status.plan.selectionManifestHash, phase: u.searchParams.get('phase'), items: samples, nextCursor: null };
    if (u.pathname.endsWith('/quality')) return status;
    if (u.pathname.endsWith('/versions/1')) return candidate;
    throw new Error(`Unexpected route ${u.pathname}`);
  };
  return { respond, state, samples, candidate, receipts, status, expireAt: (ttl: number) => { validUntil = new Date(Date.now()+ttl).toISOString(); } };
}
