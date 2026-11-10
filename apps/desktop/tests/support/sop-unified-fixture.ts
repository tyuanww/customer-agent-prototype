import { createHash } from 'node:crypto';
import type { SopGraphResult, SopSchemas } from '../../src/shared/sop-unified';

/** All names, text, IDs and image bytes here are purpose-built synthetic input. */
export function unifiedFixture(): { result: SopGraphResult; image: Buffer; entitlement: SopSchemas['IntakeEntitlement'] } {
  const key = { sourceId: 'synthetic-source', flowId: 'synthetic-flow', flowVersion: 1 };
  const applicability = { productRefs: [], scenarioRefs: [] };
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNocDjwHwAFRAKAb2WvNQAAAABJRU5ErkJggg==', 'base64');
  const scripts = ['alpha', 'beta'].map(businessEntryId => ({ sourceId: key.sourceId, businessEntryId, scriptVersion: 1 }));
  const nodes: SopSchemas['IntakeSopNode'][] = [
    { key, id: 'start', body: { kind: 'action', title: '合成资料核对', stageLabel: '核对', instruction: '请逐项确认合成记录。', audience: 'agent',
      requirements: [{ id: 'confirm-z', label: '先核对合成型号', ordinal: 1 }, { id: 'confirm-a', label: '再核对合成数量', ordinal: 2 }].reverse(),
      knowledge: [{ id: 'knowledge-one', title: '合成知识', body: '这段内容用于合成验证。', audience: 'agent' },
        { id: 'resource-knowledge', title: '合成资料', body: '这段资料用于合成验证。', audience: 'agent', resourceBinding: { resourceId: 'resource-knowledge', ownerKind: 'knowledge', ownerId: 'knowledge-one' } }],
      scripts: scripts.map((entry, index) => ({ entry, relation: index === 0 ? 'alternative' : 'complementary', condition: index === 0 ? '合成条件甲' : '合成条件乙' })) } },
    { key, id: 'decision', body: { kind: 'decision', title: '合成人工判断', stageLabel: '判断', instruction: '按明确依据选择。', audience: 'agent', requirements: [], knowledge: [], scripts: [] } },
    { key, id: 'done', body: { kind: 'terminal', title: '合成流程末步', stageLabel: '结束', instruction: '请人工确认处理结果。', audience: 'agent', requirements: [], knowledge: [], scripts: [] } },
  ];
  const result: SopGraphResult = {
    graph_digest: 'a'.repeat(64),
    flow: { header: { key, title: '合成完整任务图', anchorEntry: null, entryTerms: ['合成完整流程'], applicability, startNodeId: 'start', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null }, nodes,
      edges: [{ key, id: 'next-one', from: 'start', to: 'decision', action: { kind: 'next' } },
        { key, id: 'choice-yes', from: 'decision', to: 'done', action: { kind: 'choice', label: '明确符合', ordinal: 1, matchTerms: ['符合'], criterion: '合成记录明确包含标记', unableToDetermine: false } },
        { key, id: 'choice-unknown', from: 'decision', to: 'done', action: { kind: 'choice', label: '证据不足', ordinal: 2, matchTerms: ['不确定'], criterion: '现有合成记录不足以判断', unableToDetermine: true } }] },
    entries: scripts.map((ref, index) => ({ sourceId: key.sourceId, entry: { businessEntryId: ref.businessEntryId, scriptVersion: 1, operation: 'upsert', title: `合成话术${index + 1}`, answerText: index === 0 ? '合成原文甲。\n  保留两个空格与换行。' : '合成原文乙，逐字复制。', questions: [{ id: `synthetic-question-${index + 1}`, version: 1, text: `合成问题${index + 1}`, active: true }], productRefs: [], scenarioRefs: [], effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, applicabilityNote: '仅合成验证', familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false, category: 'sop', riskNote: '' } })),
    permissions: scripts.map(entry => ({ entry, risk_level: 'low', copy_allowed: true, source_ref: 'synthetic-facts' })),
    media: [
      { graphTarget: { kind: 'task' as const, id: 'start' }, resourceId: 'resource-task', audience: 'agent' as const },
      { graphTarget: { kind: 'knowledge' as const, id: 'knowledge-one' }, resourceId: 'image-resource-knowledge', audience: 'agent' as const },
      { entry: scripts[0]!, resourceId: 'resource-entry', audience: 'customer' as const },
    ].map((owner, index) => ({ binding: { ...owner, objectId: `synthetic-image-${index + 1}`, sha256: createHash('sha256').update(image).digest('hex'), mime: 'image/png', bytes: image.length, ordinal: 1, alt: `合成图片${index + 1}`, required: true, flowKey: key, applicability }, preview_handle: `synthetic-preview-${index + 1}`, expires_at: new Date(Date.now() + 240_000).toISOString() })),
  };
  return { result, image, entitlement: { entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release-1', shopId: 'synthetic-shop', contextGeneration: 1, revocationGeneration: 1, validUntil: new Date(Date.now() + 240_000).toISOString(), scopes: [{ tenantId: 'synthetic-tenant', appId: 'synthetic-app', brandId: 'synthetic-brand', shopId: 'synthetic-shop', domain: 'sop', sourceId: key.sourceId }] } };
}
