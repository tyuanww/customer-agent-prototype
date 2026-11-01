import type { SopTaskGraphDraftResult } from './sop-task-graph-draft.js';

/** Internal projection boundary for the future resume-v3 wire contract.
 * It is deliberately separate from IntakeSnapshot while that contract still
 * has maxItems=0 for SOP fields. No FAQ fallback or synthetic tree is allowed. */
export type SopGraphProjection = Readonly<{
  contract: 'resume-v3-candidate';
  flows: readonly Readonly<{
    header: Readonly<Record<string, unknown>>;
    nodes: readonly Readonly<Record<string, unknown>>[];
    edges: readonly Readonly<Record<string, unknown>>[];
  }>[];
  scriptBodies: readonly Readonly<Record<string, unknown>>[];
  media: readonly Readonly<Record<string, unknown>>[];
}>;

export type SopGraphProjectionResult =
  | Readonly<{ kind: 'needs-information'; publishable: false; issues: readonly string[] }>
  | Readonly<{ kind: 'projected'; publishable: false; projection: SopGraphProjection }>;

/** Project only a complete prepared draft. The result remains non-publishable
 * until the approved contract, candidate review and release transaction exist. */
export function projectSopGraph(draft: SopTaskGraphDraftResult): SopGraphProjectionResult {
  if (draft.kind !== 'prepared') return { kind: 'needs-information', publishable: false, issues: draft.issues.map(item => `${item.recordId}:${item.field}:${item.reason}`) };
  const issues: string[] = [];
  const flows = draft.flows.map(flow => {
    const nodes = flow.nodes.map(node => ({ key: node.key, id: node.id, body: node.body }));
    const nodeIds = new Set(nodes.map(node => node.id));
    if (!nodeIds.has(flow.header.startNodeId)) issues.push(`${flow.header.key.flowId}: projection contains an unresolved start node reference`);
    const edges = flow.edges.map(edge => ({ key: edge.key, id: edge.id, from: edge.from, to: edge.to, action: edge.action }));
    if (edges.some(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
      issues.push(`${flow.header.key.flowId}: projection contains an unresolved node reference`);
    }
    return { header: flow.header, nodes, edges };
  });
  if (issues.length) return { kind: 'needs-information', publishable: false, issues };
  return { kind: 'projected', publishable: false, projection: {
    contract: 'resume-v3-candidate', flows, scriptBodies: draft.scriptBodies,
    media: draft.media,
  } };
}
