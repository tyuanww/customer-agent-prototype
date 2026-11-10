import type { components, operations } from '@customer-agent/contracts/sop-unified';
import type { components as LegacyComponents } from '@customer-agent/contracts';

export const requestId = '19e3dc16-d72f-4433-a1c9-38a1ddc79c86';
export const entryRef = { sourceId: 'synthetic-faq', businessEntryId: 'entry-a', scriptVersion: 1 };
const key = { sourceId: 'synthetic-sop', flowId: 'flow-a', flowVersion: 1 };

export const knowledgeFlow: components['schemas']['IntakeSopFlowDefinition'] = {
  header: {
    key, title: '合成知识流程', anchorEntry: null, entryTerms: ['合成查询'],
    applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'task-a',
    operation: 'upsert', audience: 'agent', effectiveFrom: '2026-11-09T00:00:00Z', effectiveTo: null,
  },
  nodes: [
    {
      key, id: 'task-a',
      body: {
        kind: 'action', title: '合成任务', stageLabel: '准备', instruction: '阅读合成知识并确认。',
        audience: 'agent', requirements: [{ id: 'requirement-a', label: '已阅读', ordinal: 1 }],
        knowledge: [{ id: 'knowledge-a', title: '合成知识', body: '合成说明正文。', audience: 'agent' }],
        scripts: [],
      },
    },
    {
      key, id: 'task-end',
      body: {
        kind: 'terminal', title: '合成结束', stageLabel: '完成', instruction: '人工确认结束。',
        audience: 'agent', requirements: [], knowledge: [], scripts: [],
      },
    },
  ],
  edges: [{ key, id: 'edge-a', from: 'task-a', to: 'task-end', action: { kind: 'next' } }],
};

export const scriptFlow: components['schemas']['IntakeSopFlowDefinition'] = {
  ...knowledgeFlow,
  header: { ...knowledgeFlow.header, anchorEntry: entryRef },
  nodes: knowledgeFlow.nodes.map((node) => ({
    ...node,
    body: {
      ...node.body,
      scripts: node.id === 'task-a'
        ? [{ entry: entryRef, relation: 'independent', condition: '合成条件' }]
        : [],
    },
  })),
};

export const faqEntry: LegacyComponents['schemas']['IntakePublishedEntry'] = {
  businessEntryId: 'entry-a', scriptVersion: 1, operation: 'upsert', title: '合成 FAQ', answerText: '合成回答',
  questions: [], productRefs: [], scenarioRefs: [], effectiveFrom: '2026-11-09T00:00:00Z', effectiveTo: null,
  applicabilityNote: '', familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false,
  category: '合成分类', riskNote: '',
};

export const queryRequest: operations['querySop']['requestBody']['content']['application/json'] = {
  sop_group: '税收相关规则', shop_id: 'synthetic-shop', query_text: '合成查询',
  context_generation: 'generation-a', request_id: requestId,
};

export const permission: components['schemas']['MenokinSopQuerySopEntryPermission'] = {
  entry: entryRef, risk_level: 'low', copy_allowed: true, source_ref: 'synthetic-faq:entry-a',
};

export const ready: components['schemas']['MenokinSopQuerySopReadyResponse'] = {
  status: 'ready', request_id: requestId, release_id: 'synthetic-release',
  lease_expires_at: '2026-11-09T01:00:00Z', reasons: [],
  result: { flow: knowledgeFlow, graph_digest: 'a'.repeat(64), entries: [], media: [], permissions: [] },
};

export const queryResponses: components['schemas']['MenokinSopQuerySopQueryResponse'][] = [
  ready,
  {
    status: 'blocked', request_id: requestId, release_id: null, lease_expires_at: null, result: null,
    reasons: [{ code: 'GRAPH_UNRESOLVED' }],
  },
  {
    status: 'stale', request_id: requestId, release_id: 'synthetic-release', lease_expires_at: null, result: null,
    reasons: [{ code: 'STALE_RELEASE' }],
  },
  {
    status: 'no_match', request_id: requestId, release_id: 'synthetic-release',
    lease_expires_at: '2026-11-09T01:00:00Z', reasons: [],
    result: { flow: null, entries: [], media: [], permissions: [] },
  },
];

export function readyDigest(response: components['schemas']['MenokinSopQuerySopQueryResponse']): string | null {
  switch (response.status) {
    case 'ready': return response.result.graph_digest;
    case 'blocked':
    case 'stale':
    case 'no_match': return null;
    default: {
      const exhaustive: never = response;
      return exhaustive;
    }
  }
}
