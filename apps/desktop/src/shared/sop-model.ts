import { ALLERGY_SOP_SCENE_ID } from './sop-entry';
import {
  SOP_HIGH_RISK_BANNER,
  type SopNodeKind,
  type SopProjectedScript,
  type SopProjection,
  type SopShellState,
  type SopWindowErrorCode,
} from './sop-window';

export type SopViewerRole = 'agent' | 'coach' | 'owner' | null;

export type SopEdge = Readonly<{
  id: string;
  label: string;
  targetId: string;
}>;

export type SopNode = Readonly<{
  id: string;
  kind: SopNodeKind;
  voucher?: boolean;
  scriptId?: string;
  answerText?: string;
  scopeLabel?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  internalNote?: string;
  internalTask?: string;
  nextId?: string;
  edges: readonly SopEdge[];
}>;

export type SopTree = Readonly<{
  sceneId: string;
  sceneTitle: string;
  stageLabel: string;
  startNodeId: string;
  nodes: readonly SopNode[];
}>;

export type SopProgress = Readonly<{
  sceneId: string;
  nodeId: string;
  stepIndex: number;
}>;

export type SopPublishSet = 'fixture' | ReadonlySet<string>;

const PAYOUT_EXTRAS = /赔付|退款到账|现金红包|打款|返现|现金补偿/;

export class SopTreeValidationError extends Error {
  readonly code: 'CYCLE' | 'COPYABLE_SCRIPT' | 'VOUCHER_PAYOUT' | 'EDGE_LIMIT' | 'INVALID';
  constructor(code: SopTreeValidationError['code'], message: string) {
    super(message);
    this.name = 'SopTreeValidationError';
    this.code = code;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

export function indexSopNodes(tree: SopTree): ReadonlyMap<string, SopNode> {
  return new Map(tree.nodes.map((node) => [node.id, node]));
}

export function sopLeafScriptIds(tree: SopTree): readonly string[] {
  const ids: string[] = [];
  for (const node of tree.nodes) {
    if (node.scriptId) {
      ids.push(node.scriptId);
    }
  }
  return ids;
}

function assertAcyclic(tree: SopTree, byId: ReadonlyMap<string, SopNode>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (nodeId: string): void => {
    if (visited.has(nodeId)) {
      return;
    }
    if (visiting.has(nodeId)) {
      throw new SopTreeValidationError('CYCLE', `SOP tree contains a cycle at ${nodeId}`);
    }
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    if (node) {
      if (node.nextId) {
        walk(node.nextId);
      }
      for (const edge of node.edges) {
        walk(edge.targetId);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  walk(tree.startNodeId);
}

export function validateSopTree(tree: SopTree): void {
  if (tree.sceneId !== ALLERGY_SOP_SCENE_ID) {
    throw new SopTreeValidationError('INVALID', 'slice 1 only publishes the allergy aftersale scene');
  }
  if (!isNonEmptyString(tree.sceneTitle) || !isNonEmptyString(tree.stageLabel)) {
    throw new SopTreeValidationError('INVALID', 'SOP tree is missing titles');
  }
  const byId = indexSopNodes(tree);
  if (byId.size !== tree.nodes.length) {
    throw new SopTreeValidationError('INVALID', 'SOP node ids must be unique');
  }
  if (!byId.has(tree.startNodeId)) {
    throw new SopTreeValidationError('INVALID', 'SOP start node is missing');
  }
  for (const node of tree.nodes) {
    if (!isNonEmptyString(node.id)) {
      throw new SopTreeValidationError('INVALID', 'SOP node id is invalid');
    }
    if (node.edges.length > 4) {
      throw new SopTreeValidationError('EDGE_LIMIT', `SOP node ${node.id} has more than 4 edges`);
    }
    const edgeIds = new Set<string>();
    for (const edge of node.edges) {
      if (!isNonEmptyString(edge.id) || !isNonEmptyString(edge.label) || !isNonEmptyString(edge.targetId)) {
        throw new SopTreeValidationError('INVALID', `SOP node ${node.id} has an invalid edge`);
      }
      if (edgeIds.has(edge.id)) {
        throw new SopTreeValidationError('INVALID', `SOP node ${node.id} has duplicate edges`);
      }
      edgeIds.add(edge.id);
      if (!byId.has(edge.targetId)) {
        throw new SopTreeValidationError('INVALID', `SOP edge ${edge.id} points at a missing node`);
      }
    }
    if (node.nextId && !byId.has(node.nextId)) {
      throw new SopTreeValidationError('INVALID', `SOP node ${node.id} nextId is missing`);
    }
    if (node.kind === 'copyable') {
      if (!isNonEmptyString(node.scriptId) || !isNonEmptyString(node.answerText)) {
        throw new SopTreeValidationError('COPYABLE_SCRIPT', `copyable node ${node.id} requires scriptId`);
      }
    }
    if (node.voucher) {
      if (node.kind !== 'copyable') {
        throw new SopTreeValidationError('INVALID', `voucher node ${node.id} must be copyable`);
      }
      if (node.answerText && PAYOUT_EXTRAS.test(node.answerText)) {
        throw new SopTreeValidationError('VOUCHER_PAYOUT', `voucher node ${node.id} must not include payout extras`);
      }
    }
  }
  assertAcyclic(tree, byId);
}

export function startSopProgress(tree: SopTree): SopProgress {
  return Object.freeze({
    sceneId: tree.sceneId,
    nodeId: tree.startNodeId,
    stepIndex: 1,
  });
}

export function currentSopNode(tree: SopTree, progress: SopProgress): SopNode | null {
  if (progress.sceneId !== tree.sceneId) {
    return null;
  }
  return indexSopNodes(tree).get(progress.nodeId) ?? null;
}

export function chooseSopEdge(tree: SopTree, progress: SopProgress, edgeId: string): SopProgress | null {
  const node = currentSopNode(tree, progress);
  const edge = node?.edges.find((item) => item.id === edgeId);
  if (!node || !edge) {
    return null;
  }
  return Object.freeze({
    sceneId: tree.sceneId,
    nodeId: edge.targetId,
    stepIndex: progress.stepIndex + 1,
  });
}

export function advanceSopNext(tree: SopTree, progress: SopProgress): SopProgress | null {
  const node = currentSopNode(tree, progress);
  if (!node?.nextId) {
    return null;
  }
  return Object.freeze({
    sceneId: tree.sceneId,
    nodeId: node.nextId,
    stepIndex: progress.stepIndex + 1,
  });
}

function scriptPublished(scriptId: string | undefined, published: SopPublishSet): boolean {
  if (!scriptId) {
    return true;
  }
  if (published === 'fixture') {
    return true;
  }
  return published.has(scriptId);
}

function highRiskBannerFor(node: SopNode | null | undefined, shellState: SopShellState): string {
  if (shellState !== 'ready' || node?.kind !== 'copyable') {
    return '';
  }
  if (node.voucher === true || node.riskLevel === 'high') {
    return SOP_HIGH_RISK_BANNER;
  }
  return '';
}

function projectScript(node: SopNode): SopProjectedScript | null {
  if (node.kind !== 'copyable' || !node.scriptId || !node.answerText) {
    return null;
  }
  return Object.freeze({
    scriptId: node.scriptId,
    domain: '售后',
    questionVariants: Object.freeze([]),
    answerText: node.answerText,
    platform: '售后流程 · 合成演示',
    scopeLabel: node.scopeLabel ?? '过敏流程 · 合成演示',
    riskLevel: node.riskLevel ?? 'high',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
    rank: 1,
    score: 0,
    matchKind: 'exact',
    matchLabel: '流程话术',
  });
}

export function projectSop(input: {
  tree: SopTree;
  progress: SopProgress;
  role: SopViewerRole;
  published?: SopPublishSet;
  shellState?: SopShellState;
  copied?: boolean;
  failCode?: SopWindowErrorCode | null;
  failMessage?: string | null;
  sessionId: number;
}): SopProjection {
  const node = currentSopNode(input.tree, input.progress);
  const privileged = input.role === 'coach' || input.role === 'owner';
  const shellState = input.shellState ?? 'ready';
  const script = node ? projectScript(node) : null;
  const unpublished = Boolean(node?.scriptId) && !scriptPublished(node?.scriptId, input.published ?? 'fixture');
  const canNext = Boolean(node?.nextId) && shellState === 'ready';
  const terminal = Boolean(node) && !canNext && (node?.edges.length ?? 0) === 0 && shellState === 'ready';
  return Object.freeze({
    sceneId: input.tree.sceneId,
    sceneTitle: input.tree.sceneTitle,
    stageLabel: input.tree.stageLabel,
    stepIndex: input.progress.stepIndex,
    sessionId: input.sessionId,
    demo: true,
    shellState,
    nodeKind: shellState === 'opening' ? 'opening' : (node?.kind ?? 'internal'),
    highRiskBanner: highRiskBannerFor(node, shellState),
    internalNote: privileged ? (node?.internalNote ?? null) : null,
    internalTask: privileged ? (node?.internalTask ?? null) : null,
    script: shellState === 'ready' ? script : null,
    unpublished,
    edges: Object.freeze((shellState === 'ready' ? node?.edges ?? [] : []).map((edge) =>
      Object.freeze({ id: edge.id, label: edge.label }),
    )),
    canNext,
    terminal,
    copied: input.copied === true,
    failCode: input.failCode ?? null,
    failMessage: input.failMessage ?? null,
  });
}
