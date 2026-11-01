import { isSyntheticSopImages, isSopTerm, MAX_SYNTHETIC_SOP_IMAGE_TOTAL, type SopImage, type SopManualImageProjection, type SopProjection, type SopProjectedScript } from './sop-window';

export type SopViewerRole = 'agent' | 'coach' | 'owner' | null;
export type SopEdge = Readonly<{ id: string; label: string; targetId: string; criterion: string; unableToDetermine: boolean; matchTerms: readonly string[] }>;
export type SopScript = Readonly<{ id: string; title: string; answerText: string; condition: string; images?: readonly SopImage[] }>;
export type SopKnowledge = Readonly<{ id: string; title: string; body: string; images?: readonly SopImage[] }>;
export type SopRequirement = Readonly<{ id: string; label: string }>;
type SopTaskContent = Readonly<{
  id: string;
  title: string;
  instruction: string;
  images?: readonly SopImage[];
  stageLabel: string;
  scripts: readonly SopScript[];
  requirements: readonly SopRequirement[];
  knowledge: readonly SopKnowledge[];
  managerNote?: string;
}>;
/** Navigation is explicit: a task either advances, asks a decision, or ends. */
export type SopNode = SopTaskContent & (
  | Readonly<{ kind: 'action'; nextId: string }>
  | Readonly<{ kind: 'decision'; edges: readonly SopEdge[] }>
  | Readonly<{ kind: 'terminal' }>
);
export type SopTree = Readonly<{
  sceneId: string;
  sceneTitle: string;
  stageLabel: string;
  version: string;
  startNodeId: string;
  nodes: readonly SopNode[];
}>;
export type SopProgress = Readonly<{ sceneId: string; nodeId: string; stepIndex: number }>;
export type SopPublishSet = 'fixture' | ReadonlySet<string>;

export class SopTreeValidationError extends Error {
  readonly code: 'CYCLE' | 'INVALID';
  constructor(code: 'CYCLE' | 'INVALID', message: string) {
    super(message); this.name = 'SopTreeValidationError'; this.code = code;
  }
}
const validText = (value: string): boolean => value.trim().length > 0 && value.trim() === value;
export function indexSopNodes(tree: SopTree): ReadonlyMap<string, SopNode> {
  return new Map(tree.nodes.map(node => [node.id, node]));
}
export function validateSopTree(tree: SopTree): void {
  const fail = (message: string): never => { throw new SopTreeValidationError('INVALID', message); };
  if (![tree.sceneId, tree.sceneTitle, tree.stageLabel, tree.version].every(validText)) fail('SOP titles and version are required');
  const byId = indexSopNodes(tree);
  if (byId.size !== tree.nodes.length || !byId.has(tree.startNodeId)) fail('SOP node ids must be unique and start must exist');
  const scripts = new Map<string, Pick<SopScript, 'title' | 'answerText' | 'images'>>();
  let imageTotal = 0;
  const checkImages = (images: readonly SopImage[] | undefined): void => {
    if (images === undefined) return;
    if (!isSyntheticSopImages(images)) fail('SOP images are invalid');
    imageTotal += images.reduce((sum, image) => sum + image.dataUrl.length, 0);
    if (imageTotal > MAX_SYNTHETIC_SOP_IMAGE_TOTAL) fail('SOP images exceed the total limit');
  };
  for (const node of tree.nodes) {
    if (![node.id, node.title, node.instruction, node.stageLabel].every(validText)) fail('SOP task content is incomplete');
    checkImages(node.images);
    if (new Set(node.requirements.map(item => item.id)).size !== node.requirements.length) fail('SOP requirements must be unique');
    if (node.requirements.some(item => !validText(item.id) || !validText(item.label))) fail('SOP requirement is invalid');
    if (new Set(node.knowledge.map(item => item.id)).size !== node.knowledge.length) fail('SOP knowledge ids must be unique');
    if (node.knowledge.some(item => ![item.id, item.title, item.body].every(validText))) fail('SOP knowledge is invalid');
    node.knowledge.forEach(item => checkImages(item.images));
    const taskScriptIds = new Set<string>();
    for (const script of node.scripts) {
      if (![script.id, script.title, script.answerText, script.condition].every(validText) || taskScriptIds.has(script.id)) fail('SOP script is invalid or duplicated');
      checkImages(script.images);
      const original = scripts.get(script.id);
      const previousImages = original?.images ?? [], currentImages = script.images ?? [];
      if (original && (original.title !== script.title || original.answerText !== script.answerText || previousImages.length !== currentImages.length
        || previousImages.some((image, index) => image.alt !== currentImages[index]?.alt || image.dataUrl !== currentImages[index]?.dataUrl))) {
        fail('SOP script identity has conflicting content');
      }
      taskScriptIds.add(script.id);
      scripts.set(script.id, { title: script.title, answerText: script.answerText, images: script.images });
    }
    if (node.kind === 'decision') {
      if ('nextId' in node) fail('branch nodes cannot have nextId');
      if (node.edges.length < 2 || node.edges.length > 4) fail('SOP decisions require 2 to 4 edges');
      if (new Set(node.edges.map(edge => edge.id)).size !== node.edges.length) fail('SOP edge ids must be unique');
      if (node.edges.filter(edge => edge.unableToDetermine).length !== 1) fail('SOP decisions require exactly one unknown edge');
      for (const edge of node.edges) {
        if (![edge.id, edge.label, edge.targetId, edge.criterion].every(validText) || typeof edge.unableToDetermine !== 'boolean' || !byId.has(edge.targetId)
          || !Array.isArray(edge.matchTerms) || edge.matchTerms.length > 32 || edge.matchTerms.some(term => !isSopTerm(term))
          || new Set(edge.matchTerms).size !== edge.matchTerms.length) fail('SOP edge is invalid');
      }
    } else if (node.kind === 'action') {
      if ('edges' in node || !byId.has(node.nextId)) fail('SOP action target is invalid');
    } else if ('nextId' in node || 'edges' in node) fail('SOP terminal cannot navigate');
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new SopTreeValidationError('CYCLE', `SOP cycle at ${id}`);
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) return fail('SOP node is missing');
    visiting.add(id);
    if (node.kind === 'action') visit(node.nextId);
    if (node.kind === 'decision') node.edges.forEach(edge => visit(edge.targetId));
    visiting.delete(id); visited.add(id);
  };
  visit(tree.startNodeId);
  if (visited.size !== tree.nodes.length) fail('SOP contains unreachable tasks');
}
export function startSopProgress(tree: SopTree): SopProgress {
  return { sceneId: tree.sceneId, nodeId: tree.startNodeId, stepIndex: 1 };
}
export function currentSopNode(tree: SopTree, progress: SopProgress): SopNode | null {
  return tree.sceneId === progress.sceneId ? indexSopNodes(tree).get(progress.nodeId) ?? null : null;
}
export function chooseSopEdge(tree: SopTree, progress: SopProgress, edgeId: string): SopProgress | null {
  const node = currentSopNode(tree, progress);
  if (node?.kind !== 'decision' || 'nextId' in node) return null;
  const edge = node.edges.find(item => item.id === edgeId);
  return edge ? { sceneId: tree.sceneId, nodeId: edge.targetId, stepIndex: progress.stepIndex + 1 } : null;
}
export function advanceSopNext(tree: SopTree, progress: SopProgress): SopProgress | null {
  const node = currentSopNode(tree, progress);
  return node?.kind === 'action' ? { sceneId: tree.sceneId, nodeId: node.nextId, stepIndex: progress.stepIndex + 1 } : null;
}
/** Unfilled authoring tokens are never copied as customer-facing text. */
export function sopScriptCopyable(script: SopScript, published: SopPublishSet): boolean {
  return (published === 'fixture' || published.has(script.id)) && !/\{[^{}]*\}|【待填写[^】]*】/u.test(script.answerText);
}
export function projectSop(input: {
  tree: SopTree; progress: SopProgress; role: SopViewerRole; published?: SopPublishSet;
  copied?: boolean;
  taskId: string; revision: number; checked?: ReadonlySet<string>; selectedScriptId?: string | null;
  history?: readonly SopProgress[]; choices?: ReadonlyMap<number, string>; confirmations?: ReadonlyMap<number, readonly string[]>; waiting?: 'customer' | 'internal' | null;
}): SopProjection {
  const node = currentSopNode(input.tree, input.progress);
  if (!node) throw new SopTreeValidationError('INVALID', 'SOP progress points at a missing task');
  const waiting = input.waiting ?? null;
  const requirements = node.requirements.map(item => ({ ...item, checked: input.checked?.has(item.id) === true }));
  const satisfied = requirements.every(item => item.checked);
  const published = input.published ?? 'fixture';
  const scripts: SopProjectedScript[] = node.scripts.map(script => {
    if (!sopScriptCopyable(script, published)) return { scriptId: script.id, unpublished: true, images: [] };
    return { scriptId: script.id, title: script.title, answerText: script.answerText, condition: script.condition,
      unpublished: false, images: script.images ?? [] };
  });
  const defaultScript = scripts.length === 1 ? scripts[0] : undefined;
  const selectedScriptId = input.selectedScriptId === undefined ? defaultScript?.scriptId ?? null : input.selectedScriptId;
  return {
    sceneId: input.tree.sceneId, sceneTitle: input.tree.sceneTitle, stageLabel: node.stageLabel,
    version: input.tree.version, taskTitle: node.title, nodeId: input.progress.nodeId,
    stepIndex: input.progress.stepIndex, taskId: input.taskId, revision: input.revision, demo: true,
    nodeKind: node.kind, prompt: node.instruction, images: node.images ?? [],
    internalNote: input.role === 'coach' || input.role === 'owner' ? node.managerNote ?? null : null,
    scripts, selectedScriptId, requirements,
    knowledge: node.knowledge.map(item => ({ ...item, images: item.images ?? [] })),
    history: (input.history ?? [input.progress]).map(progress => ({
      stepIndex: progress.stepIndex, nodeId: progress.nodeId,
      title: currentSopNode(input.tree, progress)?.title ?? '',
      instruction: currentSopNode(input.tree, progress)?.instruction ?? '',
      choiceLabel: input.choices?.get(progress.stepIndex) ?? null,
      confirmedRequirements: input.confirmations?.get(progress.stepIndex) ?? [],
    })), waiting,
    edges: node.kind === 'decision' ? node.edges.map(({ id, label, criterion, matchTerms }) => ({ id, label, criterion, matchTerms })) : [],
    canNext: !waiting && satisfied && node.kind === 'action',
    canChoose: !waiting && satisfied && node.kind === 'decision',
    terminal: node.kind === 'terminal', copied: input.copied === true,
  };
}

/** Reuses execution's projection without creating a session or exposing manager notes. */
export function projectSopManualImages(trees: readonly SopTree[]): readonly SopManualImageProjection[] {
  return trees.flatMap(tree => tree.nodes.map(node => {
    const projected = projectSop({ tree, progress: { sceneId: tree.sceneId, nodeId: node.id, stepIndex: 1 }, role: 'agent', taskId: 'manual', revision: 1 });
    return { sceneId: projected.sceneId, nodeId: projected.nodeId, images: projected.images,
      scripts: projected.scripts.map(({ scriptId, images }) => ({ scriptId, images })),
      knowledge: projected.knowledge.map(({ id, images }) => ({ id, images })) };
  }));
}
