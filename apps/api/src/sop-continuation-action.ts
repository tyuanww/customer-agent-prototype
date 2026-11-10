import { createHash } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts/sop-unified';
import type { Graph } from './content-intake/sop-graph.js';
import { IntakeRejection } from './content-intake/transaction.js';

type C = components['schemas'];
type Action = C['IntakeSopActionCheck'];
type Permission = C['MenokinSopQuerySopEntryPermission'];
type EntryRef = C['IntakeSopEntryRef'];

function sameEntry(a: EntryRef, b: EntryRef): boolean {
  return a.sourceId === b.sourceId && a.businessEntryId === b.businessEntryId && a.scriptVersion === b.scriptVersion;
}

/** The raw Main-owned handle is accepted only at the HTTP boundary. SQL and
 * durable audit receive this hash, including for lost-response recovery. */
export function sopContinuationHash(value: unknown): string {
  return createHash('sha256').update(parseContractSchema('IntakeSopContinuationId', value)).digest('hex');
}

/** C validates the complete original graph, digest, exact permissions and selected
 * media before this action boundary. Main owns confirmation progress and copying.
 * This function grants no authority and writes no task progress. */
export function assertSopContinuationAction(input: {
  graph: Graph;
  graphDigest: string;
  permissions: Permission[];
  request: Action;
}): void {
  const { graph, graphDigest, permissions, request } = input;
  const { header, nodes, edges } = graph.definition;
  if (request.graphDigest !== graphDigest || request.key.sourceId !== header.key.sourceId
    || request.key.flowId !== header.key.flowId || request.key.flowVersion !== header.key.flowVersion) {
    throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
  }
  const node = nodes.find(item => item.id === request.nodeId);
  if (!node || request.action === 'open' && node.id !== header.startNodeId) {
    throw new IntakeRejection('SOP_GRAPH_INVALID', 'VALIDATION');
  }
  if (request.action === 'next' || request.action === 'choose') {
    const edge = edges.find(item => item.id === request.edgeId && item.from === node.id);
    if (!edge || request.action === 'next' && (node.body.kind !== 'action' || edge.action.kind !== 'next')
      || request.action === 'choose' && (node.body.kind !== 'decision' || edge.action.kind !== 'choice')) {
      throw new IntakeRejection('SOP_GRAPH_INVALID', 'VALIDATION');
    }
  }
  if (request.action === 'copy') {
    const ref = request.entry;
    if (!ref || !node.body.scripts.some(script => sameEntry(script.entry, ref))) {
      throw new IntakeRejection('SOP_DEPENDENCY_INVALID', 'VALIDATION');
    }
    const permission = permissions.find(item => sameEntry(item.entry, ref));
    if (!permission?.copy_allowed) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
    if (!graph.entries.some(item => sameEntry({ sourceId: item.sourceId, ...item.entry }, ref))) throw new IntakeRejection('SOP_DEPENDENCY_INVALID', 'VALIDATION');
  }
}
