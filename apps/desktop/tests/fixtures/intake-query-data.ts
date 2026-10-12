import type { components } from '@customer-agent/contracts';
type C = components['schemas'];

/** Synthetic contract wire data shared by native and Main tests; no API implementation. */
export function intakeQueryData() {
  const factsUntil = new Date(Date.now() + 600_000).toISOString();
  const state = { revoked: false, empty: false, ttl: 60_000, release: 'release-synthetic-1' };
  const source = (shopId: string): C['IntakeSource'] => ({
    scope: { tenantId: 'tenant', appId: 'app', brandId: 'brand', shopId, domain: 'product', sourceId: `source-${shopId}` },
    version: 1, templateVersion: 'faq-p1.1', ruleVersion: 'intake-p1.1', mappingVersion: 'mapping-p1.1',
    structureDigest: 'a'.repeat(64), contentIntakeMode: 'v2-preview', modeVersion: 1,
  });
  const entries: C['IntakePublishedEntry'][] = Array.from({ length: 4 }, (_, i) => ({
    businessEntryId: `entry-${i}`, scriptVersion: 1, operation: 'upsert', title: `洁面用法 ${i}`,
    answerText: `合成正文 ${i}\n第二行 保留原文`, questions: [{ id: `question-${i}`, version: 1, text: '如何洁面', active: true }], productRefs: [], scenarioRefs: [],
    effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: null, applicabilityNote: '仅限合成通用场景',
    familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false, category: '分类', riskNote: '单独风险说明',
  }));
  const vocabulary: C['IntakeVocabulary'][] = [];
  let serial = 0;
  const selections = new Map<string, C['IntakeEntitlementRequest']>();
  const leases = new Map<string, C['IntakeEntitlement']>();
  const respond = (path: string, body?: unknown): unknown => {
    if (state.revoked) throw { code: 'FORBIDDEN', reason: 'PERMISSION_CHANGED' };
    const url = new URL(path, 'http://synthetic.invalid');
    const sources = state.empty ? [] : [source('shop-a'), source('shop-b')];
    const validUntil = new Date(Date.now() + state.ttl).toISOString();
    if (url.pathname.endsWith('/authorization')) return {
      factsVersion: 1, revocationGeneration: 0, policyVersion: 1, validUntil: factsUntil, nextCursor: null,
      capabilities: sources.map(s => ({ scope: s.scope, actions: ['query'], mayAllocate: [], mayDelegate: [], validUntil: factsUntil })),
    };
    if (url.pathname.endsWith('/sources')) return { items: sources, nextCursor: null };
    if (url.pathname.endsWith('/vocabulary')) return { items: vocabulary, nextCursor: null };
    if (url.pathname.endsWith('/entitlements')) {
      const req = body as C['IntakeEntitlementRequest'];
      if (!sources.some(s => s.scope.shopId === req.shopId) || req.productIds.some(id => !vocabulary.some(v => v.id === id && v.kind === 'product')) || req.scenarioIds.some(id => !vocabulary.some(v => v.id === id && v.kind === 'scenario'))) throw { code: 'FORBIDDEN' };
      const ent: C['IntakeEntitlement'] = { entitlementId: `ent-${++serial}`, releaseId: state.release, shopId: req.shopId,
        contextGeneration: req.contextGeneration, revocationGeneration: 0, validUntil, scopes: [source(req.shopId).scope] };
      leases.set(ent.entitlementId, ent); selections.set(ent.entitlementId, structuredClone(req)); return ent;
    }
    if (url.pathname.endsWith('/snapshot')) {
      const ent = leases.get(url.searchParams.get('entitlementId')!)!;
      const selection = selections.get(ent.entitlementId)!;
      const filtered = entries.filter(e => (!e.productRefs.length || e.productRefs.some(r => selection.productIds.includes(r.id)))
        && (!e.scenarioRefs.length || e.scenarioRefs.some(r => selection.scenarioIds.includes(r.id))));
      return { releaseId: ent.releaseId, entitlementId: ent.entitlementId, contextGeneration: ent.contextGeneration,
        faq: filtered.map(entry => ({ sourceId: source(ent.shopId).scope.sourceId, entry: { ...entry, answerText: `${ent.shopId} ${entry.answerText}` } })),
        sopNodes: [], sopEdges: [], media: [], vocabulary, nextCursor: null };
    }
    throw new Error('Unexpected synthetic route');
  };
  return { state, entries, vocabulary, respond };
}
