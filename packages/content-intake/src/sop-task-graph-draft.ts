import type { MaintenanceDocument, MaintenanceReview, MaintenanceScriptLink } from './maintenance.js';

type Audience = 'agent' | 'coach';
type TermRef = Readonly<{ id: string; displayVersion: number }>;
type Applicability = Readonly<{ productRefs: readonly TermRef[]; scenarioRefs: readonly TermRef[] }>;
type FlowKey = Readonly<{ sourceId: string; flowId: string; flowVersion: number }>;
type EntryRef = Readonly<{ sourceId: string; businessEntryId: string; scriptVersion: number }>;
type FlowMapping = Readonly<{
  sceneId: string; key: FlowKey; applicability: Applicability; audience: Audience;
  anchorScriptId: string | null; effectiveFrom: string; effectiveTo: string | null;
}>;
type MediaOwner = Readonly<{ kind: 'task' | 'knowledge' | 'script'; id: string }>;
type ImageMapping = Readonly<{
  sceneId: string; resourceId: string; owner: MediaOwner; sha256: string;
  objectId: string; ordinal: number; alt: string; required: boolean;
}>;

/** Caller-supplied identities and scope are mapping claims, never authorization.
 * Empty collections mean mappings are missing, not that content can be dropped.
 * No ID, version, date, scope or image priority is generated from workbook order. */
export type SopTaskGraphMapping = Readonly<{
  flows: readonly FlowMapping[];
  entries: readonly Readonly<{ scriptId: string; entry: EntryRef }>[];
  nextEdges: readonly Readonly<{ taskId: string; edgeId: string }>[];
  resourceScopes: readonly Readonly<{ resourceId: string; applicability: Applicability }>[];
  images: readonly ImageMapping[];
}>;

type DraftIssue = Readonly<{
  kind: 'mapping-required' | 'unresolved' | 'unrepresentable';
  recordId: string; field: string; reason: string;
}>;
type Knowledge = {
  id: string; title: string; body: string; audience: Audience;
  resourceBinding?: { resourceId: string; ownerKind: 'task' | 'knowledge'; ownerId: string };
};
type TaskScript = { entry: EntryRef; relation: 'independent' | 'alternative' | 'complementary'; condition: string };
type DraftNode = {
  key: FlowKey; id: string; body: {
    kind: 'action' | 'decision' | 'terminal'; title: string; stageLabel: string; instruction: string; audience: Audience;
    requirements: { id: string; label: string; ordinal: number }[]; knowledge: Knowledge[]; scripts: TaskScript[];
  };
};
type DraftEdge = {
  key: FlowKey; id: string; from: string; to: string;
  action: { kind: 'next' } | { kind: 'choice'; label: string; ordinal: number; matchTerms: string[]; criterion: string; unableToDetermine: boolean };
};
type DraftFlow = {
  header: {
    key: FlowKey; title: string; anchorEntry: EntryRef | null; entryTerms: string[];
    applicability: Applicability; startNodeId: string; operation: 'upsert'; audience: Audience;
    effectiveFrom: string; effectiveTo: string | null;
  };
  nodes: DraftNode[]; edges: DraftEdge[];
};
type DraftMedia = {
  objectId: string; sha256: string; mime: 'image/png' | 'image/jpeg'; bytes: number;
  ordinal: number; alt: string; required: boolean; flowKey: FlowKey; resourceId: string; applicability: Applicability;
} & ({ audience: 'customer'; entry: EntryRef } | { audience: Audience; graphTarget: { kind: 'task' | 'knowledge'; id: string } });
type ScriptBody = { entry: EntryRef; title: string; answerText: string };
export type SopTaskGraphDraftResult =
  | Readonly<{ kind: 'needs-information'; publishable: false; review: 'not-verified'; issues: readonly DraftIssue[] }>
  | Readonly<{ kind: 'prepared'; publishable: false; review: 'not-verified'; flows: readonly DraftFlow[];
      media: readonly DraftMedia[]; scriptBodies: readonly ScriptBody[] }>;

const relationships: Readonly<Record<MaintenanceScriptLink['relationship'], TaskScript['relation']>> = {
  独立: 'independent', 替代: 'alternative', 配套: 'complementary',
};
const audience = (visibility: '坐席可读' | '主管可读'): Audience => visibility === '坐席可读' ? 'agent' : 'coach';
const active = (record: { review: MaintenanceReview }): boolean => record.review.state !== '停用';
const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const validVersion = (value: number): boolean => Number.isSafeInteger(value) && value >= 1;
const validScope = (value: Applicability): boolean => [value.productRefs, value.scenarioRefs].every(refs =>
  refs.length <= 100 && refs.every(ref => validId(ref.id) && validVersion(ref.displayVersion))
  && new Set(refs.map(ref => ref.id)).size === refs.length);
const scopeKey = (value: Applicability): string => JSON.stringify([value.productRefs, value.scenarioRefs].map(refs =>
  refs.map(ref => [ref.id, ref.displayVersion]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
const scopeWithin = (inner: Applicability, outer: Applicability): boolean =>
  (['productRefs', 'scenarioRefs'] as const).every(dimension => outer[dimension].length === 0
    || (inner[dimension].length > 0 && inner[dimension].every(ref => outer[dimension]
      .some(parent => parent.id === ref.id && parent.displayVersion === ref.displayVersion))));
const entryKey = (entry: EntryRef): string => JSON.stringify([entry.sourceId, entry.businessEntryId, entry.scriptVersion]);
const validEntry = (entry: EntryRef): boolean => validId(entry.sourceId) && validId(entry.businessEntryId) && validVersion(entry.scriptVersion);
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  && value.length <= 35 && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);

/** Offline preparation against governance 19c532f's sop-task-graph-resume-candidate
 * shapes.source.json. These are draft projections, not a second wire schema.
 * Consume only parseSopMaintenance's typed document. The caller must separately
 * resolve/authorize the mapping and perform candidate schema/semantic checks.
 * Workbook review fields remain unauthenticated claims. Any unresolved item
 * returns issues without partial graph or body output. No I/O or publication. */
export function prepareSopTaskGraphDraft(document: MaintenanceDocument, mapping: SopTaskGraphMapping): SopTaskGraphDraftResult {
  const issues: DraftIssue[] = [];
  const issue = (recordId: string, field: string, reason: string, kind: DraftIssue['kind'] = 'mapping-required'): void => {
    issues.push({ kind, recordId, field, reason });
  };
  const text = (id: string, field: string, value: string, limit: number): void => {
    if (!value.trim() || Array.from(value).length > limit) issue(id, field, `Provide nonempty text within ${limit} characters`, 'unresolved');
  };
  function index<T>(items: readonly T[], key: (item: T) => string, field: string): Map<string, T> {
    const result = new Map<string, T>();
    for (const item of items) {
      const id = key(item);
      if (result.has(id)) issue(id, field, 'Duplicate identity or mapping');
      result.set(id, item);
    }
    return result;
  }
  function reference<T extends { review: MaintenanceReview }>(records: Map<string, T>, id: string, owner: string, field: string): T | undefined {
    const record = records.get(id);
    if (!record || !active(record)) {
      issue(owner, field, record ? `Reference is stopped: ${id}` : `Reference is missing: ${id}`, 'unresolved');
      return undefined;
    }
    return record;
  }
  if (document.templateVersion !== 'sop-manual-authoring-v1.1') issue('', 'templateVersion', 'Reconcile the historical template explicitly');
  const scenes = index(document.scenes, item => item.id, 'scenes');
  const tasks = index(document.tasks, item => item.id, 'tasks');
  const knowledge = index(document.knowledge, item => item.id, 'knowledge');
  const scripts = index(document.scripts, item => item.id, 'scripts');
  const resources = index(document.resources, item => item.id, 'resources');
  const flowMappings = index(mapping.flows, item => item.sceneId, 'flows');
  const entryMappings = index(mapping.entries, item => item.scriptId, 'entries');
  const nextMappings = index(mapping.nextEdges, item => item.taskId, 'nextEdges');
  const resourceScopes = index(mapping.resourceScopes, item => item.resourceId, 'resourceScopes');
  const usedKnowledge = new Set<string>(), usedScripts = new Set<string>(), usedResources = new Set<string>();
  const usedImages = new Set<ImageMapping>(), usedEntries = new Set<string>(), usedNext = new Set<string>();
  const flows: DraftFlow[] = [], media: DraftMedia[] = [], scriptBodies = new Map<string, ScriptBody>();

  for (const record of [...document.scenes, ...document.tasks, ...document.branches, ...document.scripts,
    ...document.scriptLinks, ...document.requirements, ...document.knowledge, ...document.resources]) {
    if (!active(record)) continue;
    if (record.review.state === '草稿' || record.review.state === '待核对' || record.review.pendingText.trim()
      || !record.review.confirmerText.trim() || record.review.confirmerText.trim() === '待确认') {
      issue(record.id ?? '', 'review', 'Workbook fields still require clarification; a name is not authenticated review', 'unresolved');
    }
  }
  for (const scene of document.scenes.filter(active)) text(scene.id, 'title', scene.title, 512);
  for (const task of document.tasks.filter(active)) {
    text(task.id, 'title', task.title, 512); text(task.id, 'stage', task.stage, 512); text(task.id, 'instruction', task.instruction, 4096);
  }
  for (const item of document.knowledge.filter(active)) { text(item.id, 'title', item.title, 512); text(item.id, 'body', item.body, 8192); }
  for (const item of document.requirements.filter(active)) text(item.id, 'label', item.label, 1024);
  for (const item of document.branches.filter(active)) { text(item.id, 'label', item.label, 512); text(item.id, 'criterion', item.criterion, 2048); }
  for (const item of document.resources.filter(active)) text(item.id, 'title', item.title, 512);
  function resolveEntry(scriptId: string, flow: FlowMapping): EntryRef | undefined {
    const script = reference(scripts, scriptId, scriptId, 'script');
    const binding = entryMappings.get(scriptId);
    if (!binding || !validEntry(binding.entry) || binding.entry.sourceId !== flow.key.sourceId) {
      issue(scriptId, 'entry', 'Provide an exact same-source entry identity and script version');
      return undefined;
    }
    if (!script) return undefined;
    usedScripts.add(scriptId); usedEntries.add(scriptId);
    const key = entryKey(binding.entry), prior = scriptBodies.get(key);
    if (prior && (prior.title !== script.title || prior.answerText !== script.answerText)) {
      issue(scriptId, 'entry', 'Different authored bodies map to the same exact entry');
    } else scriptBodies.set(key, { entry: { ...binding.entry }, title: script.title, answerText: script.answerText });
    return { ...binding.entry };
  }
  function projectResources(ids: readonly string[], owner: MediaOwner, flow: FlowMapping): Knowledge[] {
    const projected: Knowledge[] = [];
    for (const id of ids) {
      const resource = reference(resources, id, owner.id, 'resourceIds');
      if (!resource) continue;
      usedResources.add(id);
      const scope = resourceScopes.get(id)?.applicability;
      if (!scope || !validScope(scope)) { issue(id, 'applicability', 'Provide the explicitly resolved resource scope'); continue; }
      if (!resource.scopeText.trim() || resource.scopeText.trim() === '待确认') issue(id, 'scopeText', 'Clarify the authored resource scope', 'unresolved');
      if (resource.kind === 'document') {
        if (owner.kind === 'script' || resource.visibility === '对客可用') {
          issue(id, 'resourceBinding', 'Knowledge cannot represent customer-facing text attachments', 'unrepresentable'); continue;
        }
        if (scopeKey(scope) !== scopeKey(flow.applicability)) issue(id, 'applicability', 'Text resource scope must equal flow scope');
        if (flow.audience === 'agent' && resource.visibility === '主管可读') issue(id, 'audience', 'Coach resource cannot enter an agent flow');
        text(id, 'content', resource.content, 8192);
        projected.push({ id, title: resource.title, body: resource.content, audience: audience(resource.visibility),
          resourceBinding: { resourceId: id, ownerKind: owner.kind, ownerId: owner.id } });
        continue;
      }
      if (resource.content.trim() || resource.imageCellText.trim()) {
        issue(id, 'content', 'Media has no field for additional resource text; reconcile it as explicit knowledge', 'unrepresentable');
      }
      if (!scopeWithin(scope, flow.applicability)) issue(id, 'applicability', 'Image applicability may narrow the flow scope but cannot broaden it');
      const bindings = mapping.images.filter(item => item.sceneId === flow.sceneId && item.resourceId === id
        && item.owner.kind === owner.kind && item.owner.id === owner.id);
      if (!resource.images.length) issue(id, 'images', 'Image resource has no parsed image', 'unresolved');
      if (new Set(bindings.map(item => item.ordinal)).size !== bindings.length) issue(id, 'ordinal', 'Image priorities must be explicit and unique per owner/resource');
      for (const image of resource.images) {
        const matches = bindings.filter(item => item.sha256 === image.sha256);
        if (matches.length !== 1 || resource.images.filter(item => item.sha256 === image.sha256).length !== 1) {
          issue(id, 'images', 'Each parsed image needs one unambiguous owner/hash binding'); continue;
        }
        const binding = matches[0];
        if (!binding) continue;
        if (usedImages.has(binding)) continue;
        usedImages.add(binding);
        if (!validId(binding.objectId) || !Number.isInteger(binding.ordinal) || binding.ordinal < 1 || binding.ordinal > 100
          || !binding.alt.trim() || Array.from(binding.alt).length > 1024 || typeof binding.required !== 'boolean') {
          issue(id, 'images', 'Provide object identity, priority, alt text and required flag'); continue;
        }
        if (image.mime === 'image/gif') { issue(id, 'mime', 'Convert GIF to JPEG or PNG before preparation', 'unresolved'); continue; }
        const base = { objectId: binding.objectId, sha256: image.sha256, mime: image.mime, bytes: image.bytes.length,
          ordinal: binding.ordinal, alt: binding.alt, required: binding.required, flowKey: { ...flow.key }, resourceId: id, applicability: scope };
        if (owner.kind === 'script') {
          if (resource.visibility !== '对客可用') { issue(id, 'audience', 'A script image must be explicitly customer-facing'); continue; }
          const entry = resolveEntry(owner.id, flow);
          if (entry) media.push({ ...base, audience: 'customer', entry });
        } else {
          if (resource.visibility === '对客可用') { issue(id, 'audience', 'A task/knowledge image needs an internal audience'); continue; }
          const reader = audience(resource.visibility);
          if (flow.audience === 'agent' && reader === 'coach') issue(id, 'audience', 'Coach image cannot enter an agent flow');
          media.push({ ...base, audience: reader, graphTarget: { kind: owner.kind, id: owner.id } });
        }
      }
    }
    return projected;
  }
  for (const scene of document.scenes.filter(active)) {
    const flow = flowMappings.get(scene.id);
    if (!flow) { issue(scene.id, 'flow', 'Provide source, flow identity/version, scope, audience, dates and explicit anchor choice'); continue; }
    if (!validId(flow.key.sourceId) || !validId(flow.key.flowId) || !validVersion(flow.key.flowVersion)) issue(scene.id, 'key', 'Provide valid explicit source, flow identity and version');
    if (!validScope(flow.applicability)) issue(scene.id, 'applicability', 'Provide resolved term IDs and display versions');
    if (!validDate(flow.effectiveFrom) || (flow.effectiveTo !== null && (!validDate(flow.effectiveTo)
      || Date.parse(flow.effectiveTo) <= Date.parse(flow.effectiveFrom)))) issue(scene.id, 'effectiveFrom/effectiveTo', 'Provide an explicit valid effective interval');
    if ((scene.effectiveFrom && scene.effectiveFrom !== flow.effectiveFrom) || (scene.effectiveTo && scene.effectiveTo !== flow.effectiveTo)) issue(scene.id, 'effectiveFrom/effectiveTo', 'Resolve differing authored and mapped effective dates');
    if (!scene.scopeText.trim() || scene.scopeText.trim() === '待确认') issue(scene.id, 'scopeText', 'Clarify the authored scope', 'unresolved');
    if (!scene.entryTerms?.length) issue(scene.id, 'entryTerms', 'Entry terms must be explicitly authored', 'unresolved');
    const start = reference(tasks, scene.startTaskId, scene.id, 'startTaskId');
    if (start && start.sceneId !== scene.id) issue(scene.id, 'startTaskId', 'Start task belongs to another scene', 'unresolved');
    const nodes: DraftNode[] = [], edges: DraftEdge[] = [];
    const anchorEntry = flow.anchorScriptId === null ? null : resolveEntry(flow.anchorScriptId, flow) ?? null;
    if (anchorEntry && flow.anchorScriptId !== null) {
      const script = scripts.get(flow.anchorScriptId);
      if (script) projectResources(script.resourceIds, { kind: 'script', id: script.id }, flow);
    }
    for (const task of document.tasks.filter(item => active(item) && item.sceneId === scene.id)) {
      if (task.requirements.kind === 'unconfirmed') issue(task.id, 'requirements', 'Confirm the task requirements explicitly', 'unresolved');
      if (flow.audience === 'agent' && task.visibility === '主管可读') issue(task.id, 'audience', 'Coach task cannot enter an agent flow');
      const requirements = document.requirements.filter(item => active(item) && item.taskId === task.id).flatMap(item => {
        if (item.ordinal === null) { issue(item.id, 'ordinal', 'Confirmation order is unresolved', 'unresolved'); return []; }
        return [{ id: item.id, label: item.label, ordinal: item.ordinal }];
      }).sort((a, b) => a.ordinal - b.ordinal);
      if (requirements.some((item, i) => item.ordinal !== i + 1) || (task.requirements.kind === 'none' && requirements.length)
        || (task.requirements.kind === 'specified' && !requirements.length)) issue(task.id, 'requirements', 'Confirmation configuration/order is inconsistent', 'unresolved');
      const nodeKnowledge: Knowledge[] = [];
      for (const id of task.knowledgeIds) {
        const item = reference(knowledge, id, task.id, 'knowledgeIds');
        if (!item) continue;
        usedKnowledge.add(id);
        if (flow.audience === 'agent' && item.visibility === '主管可读') issue(id, 'audience', 'Coach knowledge cannot enter an agent flow');
        nodeKnowledge.push({ id, title: item.title, body: item.body, audience: audience(item.visibility) },
          ...projectResources(item.resourceIds, { kind: 'knowledge', id }, flow));
      }
      nodeKnowledge.push(...projectResources(task.resourceIds, { kind: 'task', id: task.id }, flow));
      if (new Set(nodeKnowledge.map(item => item.id)).size !== nodeKnowledge.length) issue(task.id, 'knowledge', 'Knowledge/resource identities collide or have ambiguous owners');
      const nodeScripts: TaskScript[] = [];
      for (const link of document.scriptLinks.filter(item => active(item) && item.taskId === task.id)) {
        if (link.origin !== 'explicit') { issue(task.id, 'scriptLinks', 'Legacy associations need explicit identities'); continue; }
        if (!link.condition.trim()) issue(link.id, 'condition', 'Script applicability is unresolved', 'unresolved');
        const entry = resolveEntry(link.scriptId, flow);
        const script = scripts.get(link.scriptId);
        if (entry && script) {
          nodeScripts.push({ entry, relation: relationships[link.relationship], condition: link.condition });
          projectResources(script.resourceIds, { kind: 'script', id: script.id }, flow);
        }
      }
      if (new Set(nodeScripts.map(item => entryKey(item.entry))).size !== nodeScripts.length) issue(task.id, 'scripts', 'An exact entry may appear only once per task');
      if (requirements.length > 32 || nodeKnowledge.length > 32 || nodeScripts.length > 32) issue(task.id, 'body', 'Candidate permits at most 32 requirements, knowledge items and scripts each');
      nodes.push({ key: { ...flow.key }, id: task.id, body: { kind: task.kind, title: task.title, stageLabel: task.stage,
        instruction: task.instruction, audience: audience(task.visibility), requirements, knowledge: nodeKnowledge, scripts: nodeScripts } });
      if (task.kind === 'action') {
        const next = reference(tasks, task.nextTaskId, task.id, 'nextTaskId'), binding = nextMappings.get(task.id);
        if (next && next.sceneId !== scene.id) issue(task.id, 'nextTaskId', 'Next task belongs to another scene', 'unresolved');
        if (!binding || !validId(binding.edgeId)) issue(task.id, 'edgeId', 'Provide a stable ID for the next edge');
        else { usedNext.add(task.id); edges.push({ key: { ...flow.key }, id: binding.edgeId, from: task.id, to: task.nextTaskId, action: { kind: 'next' } }); }
      }
      for (const branch of document.branches.filter(item => active(item) && item.taskId === task.id)
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
        const target = reference(tasks, branch.targetTaskId, branch.id, 'targetTaskId');
        if (target && target.sceneId !== scene.id) issue(branch.id, 'targetTaskId', 'Branch target belongs to another scene', 'unresolved');
        if (branch.ordinal === null || branch.matchTerms === null) { issue(branch.id, 'ordinal/matchTerms', 'Branch order or terms are unresolved', 'unresolved'); continue; }
        edges.push({ key: { ...flow.key }, id: branch.id, from: task.id, to: branch.targetTaskId, action: { kind: 'choice',
          label: branch.label, ordinal: branch.ordinal, matchTerms: [...branch.matchTerms], criterion: branch.criterion, unableToDetermine: branch.unableToDetermine } });
      }
    }
    if (!nodes.length) issue(scene.id, 'nodes', 'FlowDefinition requires at least one task; standalone knowledge has no top-level slot', 'unrepresentable');
    if (nodes.length > 128 || edges.length > 512) issue(scene.id, 'nodes/edges', 'Candidate flow exceeds 128 nodes or 512 edges');
    if (new Set(edges.map(item => item.id)).size !== edges.length) issue(scene.id, 'edges', 'Next and choice edge identities collide');
    flows.push({ header: { key: { ...flow.key }, title: scene.title, anchorEntry, entryTerms: [...(scene.entryTerms ?? [])],
      applicability: flow.applicability, startNodeId: scene.startTaskId, operation: 'upsert', audience: flow.audience,
      effectiveFrom: flow.effectiveFrom, effectiveTo: flow.effectiveTo }, nodes, edges });
  }
  for (const task of document.tasks.filter(active)) reference(scenes, task.sceneId, task.id, 'sceneId');
  for (const item of [...document.branches, ...document.requirements, ...document.scriptLinks].filter(active)) reference(tasks, item.taskId, item.id ?? '', 'taskId');
  for (const item of document.knowledge.filter(active)) if (!usedKnowledge.has(item.id)) issue(item.id, 'knowledge', 'Knowledge has no explicit task owner; the candidate has no standalone knowledge collection', 'unrepresentable');
  for (const item of document.scripts.filter(active)) if (!usedScripts.has(item.id)) issue(item.id, 'scriptLinks', 'Script needs an explicit task or anchor association');
  for (const item of document.resources.filter(active)) if (!usedResources.has(item.id)) issue(item.id, 'resourceIds', 'Resource needs an explicit owner');
  for (const item of mapping.images) if (!usedImages.has(item)) issue(item.resourceId, 'images', 'Image mapping does not match an active owner and parsed hash');
  for (const item of mapping.flows) {
    const scene = scenes.get(item.sceneId);
    if (!scene || !active(scene)) issue(item.sceneId, 'flows', 'Flow mapping targets a missing or stopped scene');
  }
  for (const item of mapping.entries) if (!usedEntries.has(item.scriptId)) issue(item.scriptId, 'entries', 'Entry mapping is unused');
  for (const item of mapping.nextEdges) if (!usedNext.has(item.taskId)) issue(item.taskId, 'nextEdges', 'Next-edge mapping is unused');
  for (const item of mapping.resourceScopes) if (!usedResources.has(item.resourceId)) issue(item.resourceId, 'resourceScopes', 'Resource scope mapping is unused');
  if (new Set(flows.map(flow => JSON.stringify(flow.header.key))).size !== flows.length) issue('', 'flows', 'Multiple scenes map to the same flow identity/version');
  if (flows.length > 100 || media.length > 500) issue('', 'flows/media', 'Candidate exceeds 100 flows or 500 media bindings');
  if (!flows.length) issue('', 'flows', 'No active task flow can be prepared', 'unrepresentable');
  if (issues.length) return { kind: 'needs-information', publishable: false, review: 'not-verified', issues };
  return { kind: 'prepared', publishable: false, review: 'not-verified', flows, media, scriptBodies: [...scriptBodies.values()] };
}
