import type {
  MenokinExecutionRow,
  MenokinSopCandidate,
} from './menokin-sop-candidate.js';

export type MenokinSopGraphIssueCode =
  | 'GRAPH_BRANCH_SOURCE_MISSING'
  | 'GRAPH_BRANCH_TARGET_MISSING'
  | 'GRAPH_CYCLE_REQUIRES_REVIEW'
  | 'GRAPH_NODE_UNRESOLVED'
  | 'GRAPH_NODE_KEY_MISMATCH'
  | 'GRAPH_SIZE_LIMIT'
  | 'GRAPH_SOURCE_GROUP_MISMATCH'
  | 'GRAPH_TERMINAL_HAS_OUTGOING';

export type MenokinSopGraphIssue = Readonly<{
  code: MenokinSopGraphIssueCode;
  rowId: string | null;
  nodeIds: readonly string[];
}>;

export type MenokinSopGraphReport = Readonly<{
  ok: boolean;
  status: 'ready' | 'blocked';
  nodeCount: number;
  edgeCount: number;
  issues: readonly MenokinSopGraphIssue[];
  isolatedExecutionIds: readonly string[];
}>;

const issue = (
  code: MenokinSopGraphIssueCode,
  rowId: string | null,
  nodeIds: readonly string[] = [],
): MenokinSopGraphIssue => ({ code, rowId, nodeIds: [...nodeIds].sort() });

const isTerminal = (row: MenokinExecutionRow): boolean => row.nodeType === 'terminal'
  || row.nodeKey === 'E1'
  || row.nodeKey === 'E2';

const addEdge = (adjacency: Map<string, Set<string>>, from: string, to: string): void => {
  const targets = adjacency.get(from) ?? new Set<string>();
  targets.add(to);
  adjacency.set(from, targets);
};

const sortedTargets = (adjacency: Map<string, Set<string>>, from: string): readonly string[] => [
  ...(adjacency.get(from) ?? new Set<string>()),
].sort();

const findCycles = (nodeIds: readonly string[], adjacency: Map<string, Set<string>>): readonly string[][] => {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const frames: { nodeId: string; targets: readonly string[]; nextIndex: number }[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  for (const nodeId of [...nodeIds].sort()) {
    if ((state.get(nodeId) ?? 0) !== 0) continue;
    state.set(nodeId, 1);
    stack.push(nodeId);
    frames.push({ nodeId, targets: sortedTargets(adjacency, nodeId), nextIndex: 0 });
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      if (frame.nextIndex >= frame.targets.length) {
        frames.pop();
        stack.pop();
        state.set(frame.nodeId, 2);
        continue;
      }
      const target = frame.targets[frame.nextIndex]!;
      frame.nextIndex += 1;
      const targetState = state.get(target) ?? 0;
      if (targetState === 0) {
        state.set(target, 1);
        stack.push(target);
        frames.push({ nodeId: target, targets: sortedTargets(adjacency, target), nextIndex: 0 });
      } else if (targetState === 1) {
        const start = stack.indexOf(target);
        const cycle = [...stack.slice(start), target];
        const key = cycle.slice(0, -1).sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      }
    }
  }
  return cycles;
};

/**
 * Validate only the topology that the candidate proves. Missing business
 * targets and unresolved nodes stay blocked. The function does not infer a
 * start node or decide whether a reviewed cycle is a valid business loop.
 */
export function validateMenokinSopGraph(candidate: MenokinSopCandidate): MenokinSopGraphReport {
  const executions = [...candidate.tables.executionTasks.rows];
  const branches = [...candidate.tables.decisionBranches.rows];
  const executionById = new Map(executions.map((row) => [row.id, row]));
  const adjacency = new Map<string, Set<string>>();
  const incoming = new Set<string>();
  const issues: MenokinSopGraphIssue[] = [];
  let edgeCount = 0;

  if (executions.length > 100_000 || branches.length > 200_000) {
    return {
      ok: false,
      status: 'blocked',
      nodeCount: executions.length,
      edgeCount: 0,
      issues: [issue('GRAPH_SIZE_LIMIT', null)],
      isolatedExecutionIds: [],
    };
  }

  for (const row of executions) {
    if (row.nodeKey === null || row.nodeType === 'unresolved') {
      issues.push(issue('GRAPH_NODE_UNRESOLVED', row.id));
    }
  }

  for (const branch of branches) {
    const from = branch.fromExecutionId === null ? undefined : executionById.get(branch.fromExecutionId);
    const target = branch.targetExecutionId === null ? undefined : executionById.get(branch.targetExecutionId);
    if (from === undefined) {
      issues.push(issue('GRAPH_BRANCH_SOURCE_MISSING', branch.id, branch.fromExecutionId === null ? [] : [branch.fromExecutionId]));
    }
    if (target === undefined) {
      issues.push(issue('GRAPH_BRANCH_TARGET_MISSING', branch.id, branch.targetExecutionId === null ? [] : [branch.targetExecutionId]));
    }
    if (from !== undefined && isTerminal(from)) {
      issues.push(issue('GRAPH_TERMINAL_HAS_OUTGOING', from.id, [from.id, ...(target ? [target.id] : [])]));
    }
    if (from === undefined || target === undefined) continue;
    if (branch.fromNodeKey !== from.nodeKey || branch.targetNodeKey !== target.nodeKey) {
      issues.push(issue('GRAPH_NODE_KEY_MISMATCH', branch.id, [from.id, target.id]));
    }
    const branchGroup = branch.sourceRefs[0]?.sheetName;
    if (branchGroup !== from.sourceRefs[0]?.sheetName || branchGroup !== target.sourceRefs[0]?.sheetName) {
      issues.push(issue('GRAPH_SOURCE_GROUP_MISMATCH', branch.id, [from.id, target.id]));
    }
    addEdge(adjacency, from.id, target.id);
    incoming.add(target.id);
    edgeCount += 1;
  }

  const cycles = findCycles(executions.map((row) => row.id), adjacency);
  for (const cycle of cycles) {
    issues.push(issue('GRAPH_CYCLE_REQUIRES_REVIEW', cycle[0] ?? null, cycle));
  }

  const isolatedExecutionIds = executions
    .filter((row) => !adjacency.has(row.id) && !incoming.has(row.id))
    .map((row) => row.id)
    .sort();
  const ok = issues.length === 0;
  return {
    ok,
    status: ok ? 'ready' : 'blocked',
    nodeCount: executions.length,
    edgeCount,
    issues,
    isolatedExecutionIds,
  };
}
