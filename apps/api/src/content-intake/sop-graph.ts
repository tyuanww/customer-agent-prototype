import { parseContractSchema as parse } from '@customer-agent/contracts/sop-unified';
import { parseContractSchema as parseResource } from '@customer-agent/contracts/sop-resource-disable';
import { parseContractSchema as parseMaterial, isContractValidationError, intakeView, type components } from './contract-view.js';
import { parseSopTaskWorkbook, SOP_TASK_FORMAT, SOP_RESOURCE_FORMAT, SOP_TASK_SHEETS,
  type SopTaskWorkbook, type SopTaskRow } from '@customer-agent/content-intake';
import type { Source } from './authority.js';
import { authorize } from './authority.js';
import { readCandidate, type Job } from './candidate.js';
import { canonical, digest } from './material.js';
import { IntakeRejection, type IntakeTransaction, type Principal } from './transaction.js';
import { candidateContext } from './candidate.js';
import { sourceGraphFormat } from './input-format.js';
import type { ContentAttachmentStore, ReservedAttachment } from '../content-object-store.js';
import type { AuthenticatedUser } from '../auth-service.js';
import type { createIntakeTransactions } from './transaction.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type C = components['schemas'];
type Flow = C['IntakeSopFlowDefinition'];
type Entry = C['IntakeEntry'];
type Media = C['IntakeSopMedia'];
type Published = { sourceId: string; entry: C['IntakePublishedEntry'] };
export type Graph = { definition: Flow; entries: Published[]; media: Media[] };
export type GraphMaterial = C['IntakeMaterial'] & { canonicalEncodingVersion: 'candidate-sop-task-graph-v2';
  sopFlows: Flow[]; sopDifferences: C['IntakeSopFlowDifference'][]; mappingDigest: string }
  | Extract<C['IntakeMaterial'], { canonicalEncodingVersion: 'candidate-sop-resource-disable-v1' }>;
type ResourceHistory = { baseReleaseSeq: number | null;
  bindings: { resourceId: string; binding: C['IntakeResourceDisableBinding'] }[] };
export type GraphBase = { entries: Entry[]; graphs: Graph[]; recentDisables: number;
  versions: Record<string, number>; resourceHistory: ResourceHistory | null };
export const isGraphSource = (source: Source): boolean => sourceGraphFormat(source) !== null;
export function graphMaterialHeader(material: C['IntakeMaterial']) {
  const { entries: _entries, differences: _differences, sopFlows: _flows, sopDifferences: _sopDifferences, ...remaining } = material;
  if ('resourceDisables' in remaining) {
    const { resourceDisables: _resources, ...header } = remaining;
    return header;
  }
  return remaining;
}
const fail = (reason: 'SOP_MAPPING_REQUIRED' | 'SOP_GRAPH_INVALID' | 'SOP_DEPENDENCY_INVALID' = 'SOP_MAPPING_REQUIRED'): never => {
  throw new IntakeRejection(reason, 'VALIDATION');
};
const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  return raw as Record<string, unknown>;
};
const list = (raw: string | undefined): string[] => {
  if (raw === '') return [];
  if (raw === undefined) return fail();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail(); }
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.length) || new Set(value).size !== value.length) return fail();
  return value as string[];
};
const json = (raw: string | undefined): unknown => {
  if (!raw) return fail();
  try { return JSON.parse(raw); } catch { return fail(); }
};
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sorted = <T>(values: readonly T[], key: (value: T) => string): T[] => [...values].sort((a, b) => compare(key(a), key(b)));
function sortResourceBindings(bindings: C['IntakeResourceDisableBinding'][]): C['IntakeResourceDisableBinding'][] {
  const unique = new Set(bindings.map(binding => canonical(binding)));
  if (unique.size !== bindings.length) return fail();
  return [...bindings].sort((a, b) => {
    const graph = a.releaseSeq - b.releaseSeq || compare(a.releaseId, b.releaseId)
      || compare(a.flowKey.sourceId, b.flowKey.sourceId) || compare(a.flowKey.flowId, b.flowKey.flowId)
      || a.flowKey.flowVersion - b.flowKey.flowVersion || compare(a.owner.kind, b.owner.kind);
    if (graph) return graph;
    let owner = 0;
    if (a.owner.kind === 'entry' && b.owner.kind === 'entry') {
      owner = compare(a.owner.entry.sourceId, b.owner.entry.sourceId)
        || compare(a.owner.entry.businessEntryId, b.owner.entry.businessEntryId)
        || a.owner.entry.scriptVersion - b.owner.entry.scriptVersion;
    } else if (a.owner.kind !== 'entry' && b.owner.kind !== 'entry') owner = compare(a.owner.id, b.owner.id);
    if (owner) return owner;
    const kind = compare(a.content.kind, b.content.kind);
    if (kind) return kind;
    if (a.content.kind === 'image' && b.content.kind === 'image') {
      return a.content.ordinal - b.content.ordinal || compare(a.content.objectId, b.content.objectId);
    }
    if (a.content.kind === 'knowledge' && b.content.kind === 'knowledge') {
      return compare(a.content.nodeId, b.content.nodeId) || compare(a.content.contentDigest, b.content.contentDigest);
    }
    return 0;
  });
}
const refKey = (ref: C['IntakeSopEntryRef']): string => canonical([ref.sourceId, ref.businessEntryId, ref.scriptVersion]);
const flowKey = (key: C['IntakeSopFlowKey']): string => canonical([key.sourceId, key.flowId, key.flowVersion]);
export function mediaKey(media: Media): string {
  return canonical([flowKey(media.flowKey), media.entry ? 'entry' : media.graphTarget?.kind ?? fail('SOP_DEPENDENCY_INVALID'),
    media.entry ? refKey(media.entry) : media.graphTarget?.id ?? fail('SOP_DEPENDENCY_INVALID'), media.ordinal, media.objectId]);
}
const sortMedia = (items: readonly Media[]): Media[] => [...items].sort((a, b) => {
  const owner = (media: Media) => media.entry ? ['entry', media.entry.businessEntryId] : [media.graphTarget?.kind ?? '', media.graphTarget?.id ?? ''];
  const left = owner(a), right = owner(b);
  return compare(a.flowKey.sourceId, b.flowKey.sourceId) || compare(a.flowKey.flowId, b.flowKey.flowId)
    || a.flowKey.flowVersion - b.flowKey.flowVersion || compare(left[0]!, right[0]!) || compare(left[1]!, right[1]!)
    || (a.entry?.scriptVersion ?? 0) - (b.entry?.scriptVersion ?? 0) || a.ordinal - b.ordinal || compare(a.objectId, b.objectId);
});
export function published(sourceId: string, entry: Entry): Published {
  const { internalNote: _internal, attachmentNote: _attachment, ...body } = entry;
  return { sourceId, entry: parse('IntakePublishedEntry', { ...body, questions: body.questions.filter(q => q.active) }) };
}
const applicability = (raw: unknown): C['IntakeSopApplicability'] => {
  const value = parse('IntakeSopApplicability', raw);
  return { productRefs: sorted(value.productRefs, r => r.id), scenarioRefs: sorted(value.scenarioRefs, r => r.id) };
};
const within = (child: C['IntakeSopApplicability'], parent: C['IntakeSopApplicability']): boolean =>
  (['productRefs', 'scenarioRefs'] as const).every(kind => parent[kind].length === 0
    || child[kind].length > 0 && child[kind].every(ref => parent[kind].some(p => p.id === ref.id && p.displayVersion === ref.displayVersion)));
export const graphDigest = (graph: Graph): string => digest(canonical(graph));
export function graphFor(material: GraphMaterial, definition: Flow): Graph {
  const refs = new Set([...(definition.header.anchorEntry ? [definition.header.anchorEntry] : []),
    ...definition.nodes.flatMap(node => node.body.scripts.map(script => script.entry))].map(refKey));
  const entries = material.entries.filter(entry => refs.has(refKey({ sourceId: material.scope.sourceId,
    businessEntryId: entry.businessEntryId, scriptVersion: entry.scriptVersion }))).map(entry => published(material.scope.sourceId, entry));
  const graph = { definition, entries: sorted(entries, item => refKey({ sourceId: item.sourceId, ...item.entry })),
    media: sortMedia(material.media.filter(media => flowKey(media.flowKey) === flowKey(definition.header.key))) };
  validateGraph(graph);
  return graph;
}

/** The complete immutable graph is validated before filtering or projecting it.
 * Every consumer uses the same closure and canonical payload. */
export function validateGraph(graph: Graph): void {
  const definition = parse('IntakeSopFlowDefinition', graph.definition), { header, nodes, edges } = definition;
  const key = flowKey(header.key), nodeById = new Map(nodes.map(node => [node.id, node]));
  if (nodeById.size !== nodes.length || !nodeById.has(header.startNodeId)
    || new Set(edges.map(edge => edge.id)).size !== edges.length) return fail('SOP_GRAPH_INVALID');
  const entries = new Map(graph.entries.map(item => [refKey({ sourceId: item.sourceId, ...item.entry }), item]));
  const required = new Set([...(header.anchorEntry ? [header.anchorEntry] : []), ...nodes.flatMap(n => n.body.scripts.map(s => s.entry))].map(refKey));
  if (entries.size !== graph.entries.length || entries.size !== required.size || [...required].some(ref => !entries.has(ref))) return fail('SOP_DEPENDENCY_INVALID');
  const knowledge = new Map<string, string>();
  for (const node of nodes) {
    if (flowKey(node.key) !== key || header.audience === 'agent' && node.body.audience !== 'agent') return fail('SOP_GRAPH_INVALID');
    const requirements = node.body.requirements;
    if (new Set(requirements.map(r => r.id)).size !== requirements.length
      || sorted(requirements, r => String(r.ordinal).padStart(2, '0')).some((r, i) => r.ordinal !== i + 1)
      || new Set(node.body.scripts.map(s => refKey(s.entry))).size !== node.body.scripts.length) return fail('SOP_GRAPH_INVALID');
    for (const item of node.body.knowledge) {
      if (header.audience === 'agent' && item.audience !== 'agent') return fail('SOP_GRAPH_INVALID');
      const previous = knowledge.get(item.id), body = canonical({ title: item.title, body: item.body, audience: item.audience });
      if (previous && previous !== body) return fail('SOP_GRAPH_INVALID');
      knowledge.set(item.id, body);
      if (item.resourceBinding && (item.resourceBinding.resourceId !== item.id
        || item.resourceBinding.ownerKind === 'task' && item.resourceBinding.ownerId !== node.id
        || item.resourceBinding.ownerKind === 'knowledge' && !node.body.knowledge.some(k => k.id === item.resourceBinding?.ownerId))) return fail('SOP_DEPENDENCY_INVALID');
    }
    if (/过敏/u.test(node.body.title + node.body.instruction)
      && (!node.body.instruction.includes('停手') || !node.body.instruction.includes('确认'))) return fail('SOP_GRAPH_INVALID');
    const outgoing = edges.filter(edge => edge.from === node.id);
    if (node.body.kind === 'terminal' && outgoing.length !== 0
      || node.body.kind === 'action' && (outgoing.length !== 1 || outgoing[0]?.action.kind !== 'next')) return fail('SOP_GRAPH_INVALID');
    if (node.body.kind === 'decision') {
      const choices = outgoing.map(edge => edge.action);
      if (choices.length < 2 || choices.length > 4 || choices.some(choice => choice.kind !== 'choice')
        || choices.filter(choice => choice.kind === 'choice' && choice.unableToDetermine).length !== 1) return fail('SOP_GRAPH_INVALID');
      const ordinals = choices.flatMap(choice => choice.kind === 'choice' ? [choice.ordinal] : []).sort((a, b) => a - b);
      const labels = choices.flatMap(choice => choice.kind === 'choice' ? [choice.label] : []);
      if (ordinals.some((ordinal, i) => ordinal !== i + 1) || new Set(labels).size !== labels.length) return fail('SOP_GRAPH_INVALID');
    }
  }
  for (const edge of edges) {
    if (flowKey(edge.key) !== key || !nodeById.has(edge.from) || !nodeById.has(edge.to)) return fail('SOP_GRAPH_INVALID');
  }
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) return fail('SOP_GRAPH_INVALID');
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of edges.filter(edge => edge.from === id)) visit(edge.to);
    active.delete(id); visited.add(id);
  };
  visit(header.startNodeId);
  if (visited.size !== nodes.length) return fail('SOP_GRAPH_INVALID');
  for (const item of graph.entries) {
    if (item.sourceId !== header.key.sourceId || item.entry.operation !== 'upsert'
      || !within(item.entry, header.applicability)) return fail('SOP_DEPENDENCY_INVALID');
  }
  const owners = new Set<string>();
  for (const raw of graph.media) {
    const media = parse('IntakeSopMedia', raw);
    const owner = media.entry ? refKey(media.entry) : media.graphTarget?.id ?? fail('SOP_DEPENDENCY_INVALID');
    const identity = canonical([media.entry ? 'entry' : media.graphTarget?.kind ?? fail('SOP_DEPENDENCY_INVALID'), owner, media.ordinal]);
    if (flowKey(media.flowKey) !== key || !within(media.applicability, header.applicability) || owners.has(identity)
      || header.audience === 'agent' && media.audience === 'coach'
      || media.entry && (!required.has(refKey(media.entry)) || media.audience !== 'customer')
      || media.graphTarget?.kind === 'task' && !nodeById.has(media.graphTarget.id)
      || media.graphTarget?.kind === 'knowledge' && !knowledge.has(media.graphTarget.id)) return fail('SOP_DEPENDENCY_INVALID');
    owners.add(identity);
  }
  if (Buffer.byteLength(JSON.stringify(definition)) > 524_288) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  canonical(graph);
}

function rowsById(rows: SopTaskRow[], column: string): Map<string, SopTaskRow['values']> {
  const result = new Map<string, SopTaskRow['values']>();
  for (const row of rows) {
    const id = row.values[column];
    if (!id || result.has(id)) return fail();
    result.set(id, row.values);
  }
  return result;
}
function audience(value: string | undefined): 'agent' | 'coach' | 'customer' {
  if (value === '坐席可读') return 'agent';
  if (value === '主管可读') return 'coach';
  if (value === '对客可用') return 'customer';
  return fail();
}

export async function prepareImport(bytes: Buffer, source: Source, base: GraphBase): Promise<{
  workbook: SopTaskWorkbook; entries: Entry[]; flows: Flow[]; mediaOwners: { resourceId: string; flow: Flow;
    owner: { entry: C['IntakeSopEntryRef'] } | { graphTarget: NonNullable<Media['graphTarget']> }; row: SopTaskRow['values'] }[];
  resourceDisables: SopTaskRow[];
}> {
  const format = sourceGraphFormat(source);
  if (!format) return fail();
  const mapping = object(source.graphMapping), flowMappings = object(mapping.flows), entryMappings = object(mapping.entries);
  if (mapping.riskLevel !== 'routine' && mapping.riskLevel !== 'critical') return fail();
  try { parse('IntakeSourceClaim', { ...object(mapping.sourceClaim), fileSha256: digest(bytes) }); }
  catch (error) { if (isContractValidationError(error)) return fail(); throw error; }
  const workbook = await parseSopTaskWorkbook(bytes, format.ruleVersion);
  const before = new Map(base.entries.map(entry => [entry.businessEntryId, entry]));
  const entries = new Map(before);
  rowsById(workbook.sheets['资源与图片'], '资源编号');
  const resourceDisables = workbook.sheets['资源与图片'].filter(row => row.values['维护状态'] === '停用');
  const resources = rowsById(workbook.sheets['资源与图片'].filter(row => row.values['维护状态'] === '启用'), '资源编号');
  const knowledge = rowsById(workbook.sheets['知识与案例'], '知识编号');
  for (const [id, row] of rowsById(workbook.sheets['客户话术'], '话术编号')) {
    const metadata = object(entryMappings[id]);
    const old = before.get(id);
    let entry: Entry;
    try {
      entry = parse('IntakeEntry', { ...metadata, businessEntryId: id, scriptVersion: old?.scriptVersion ?? 1,
        operation: row['维护状态'] === '停用' ? 'disable' : 'upsert', title: row['话术标题'], answerText: row['对客正文'] });
    } catch (error) { if (isContractValidationError(error)) return fail(); throw error; }
    if (old && canonical({ ...old, scriptVersion: 1 }) !== canonical({ ...entry, scriptVersion: 1 })) entry.scriptVersion++;
    if (!old && entry.operation === 'disable') return fail();
    entries.set(id, entry);
  }
  const entryRef = (id: string): C['IntakeSopEntryRef'] => {
    const entry = entries.get(id);
    if (!entry || entry.operation !== 'upsert') return fail('SOP_DEPENDENCY_INVALID');
    return { sourceId: source.scope.sourceId, businessEntryId: id, scriptVersion: entry.scriptVersion };
  };
  const flows: Flow[] = [];
  const mediaOwners: Awaited<ReturnType<typeof prepareImport>>['mediaOwners'] = [];
  const usedResources = new Set<string>(), usedKnowledge = new Set<string>(), usedTasks = new Set<string>();
  const taskRows = workbook.sheets['执行任务'];
  if (taskRows.some(row => !['任务', '话术引用', '确认项'].includes(row.values['记录类型'] ?? ''))) return fail();
  const tasks = rowsById(taskRows.filter(row => row.values['记录类型'] === '任务'), '任务编号');
  const associationIds = new Set<string>(), confirmationIds = new Set<string>();
  for (const row of taskRows.filter(row => row.values['记录类型'] !== '任务')) {
    const parent = tasks.get(row.values['任务编号'] ?? '');
    if (!parent || row.values['场景编号'] !== parent['场景编号']) return fail();
    const set = row.values['记录类型'] === '话术引用' ? associationIds : confirmationIds;
    const id = row.values[row.values['记录类型'] === '话术引用' ? '关联编号' : '确认项编号'];
    if (!id || set.has(id)) return fail();
    set.add(id);
  }
  for (const [id, row] of rowsById(workbook.sheets['场景目录'], '场景编号')) {
    const registered = object(flowMappings[id]);
    if (!('anchorEntry' in registered) || !('audience' in registered)) return fail();
    const prior = base.graphs.find(graph => graph.definition.header.key.flowId === id);
    const key = { sourceId: source.scope.sourceId, flowId: id, flowVersion: prior?.definition.header.key.flowVersion ?? 1 };
    const flow: Flow = { header: parse('IntakeSopFlowHeader', { key, title: row['场景名称'],
      anchorEntry: registered.anchorEntry === null ? null : typeof registered.anchorEntry === 'string' ? entryRef(registered.anchorEntry) : fail(),
      entryTerms: sorted(list(row['入口词']), term => term), applicability: applicability(json(row['适用范围'])),
      startNodeId: row['起始任务编号'], operation: row['维护状态'] === '停用' ? 'disable' : 'upsert',
      audience: registered.audience, effectiveFrom: row['生效时间'], effectiveTo: row['失效时间'] || null }), nodes: [], edges: [] };
    if (!prior && flow.header.operation === 'disable') return fail();
    const bindResources = (ids: string[], owner: Awaited<ReturnType<typeof prepareImport>>['mediaOwners'][number]['owner'], target: C['IntakeSopKnowledge'][]): void => {
      for (const resourceId of ids) {
        const resource = resources.get(resourceId);
        if (!resource) return fail();
        usedResources.add(resourceId);
        const scope = applicability(json(resource['适用范围']));
        if (resource['资源类型'] === '图片') mediaOwners.push({ resourceId, flow, owner, row: resource });
        else if (resource['资源类型'] === '资料') {
          if ('entry' in owner || audience(resource['可见对象']) === 'customer'
            || canonical(scope) !== canonical(flow.header.applicability)) return fail();
          target.push(parse('IntakeSopKnowledge', { id: resourceId, title: resource['资源名称'], body: resource['资源内容'],
            audience: audience(resource['可见对象']), resourceBinding: { resourceId, ownerKind: owner.graphTarget.kind, ownerId: owner.graphTarget.id } }));
        } else return fail();
      }
    };
    for (const [taskId, task] of tasks) {
      if (task['场景编号'] !== id) continue;
      usedTasks.add(taskId);
      const rows = taskRows.filter(row => row.values['任务编号'] === taskId).map(row => row.values);
      const requirements = rows.filter(row => row['记录类型'] === '确认项').map(row => parse('IntakeSopRequirement', {
        id: row['确认项编号'], label: row['确认项文字'], ordinal: Number(row['确认项顺序']) }));
      if (!['有确认项', '无确认项'].includes(task['确认项配置'] ?? '')
        || (task['确认项配置'] === '有确认项') !== (requirements.length > 0)) return fail();
      const scripts = rows.filter(row => row['记录类型'] === '话术引用').map(row => {
        const relations = { 独立: 'independent', 替代: 'alternative', 配套: 'complementary' } as const;
        const relation = row['话术关系'];
        if (relation !== '独立' && relation !== '替代' && relation !== '配套') return fail();
        return { entry: entryRef(row['话术编号'] ?? ''), relation: relations[relation], condition: row['适用条件'] ?? '' };
      });
      const items: C['IntakeSopKnowledge'][] = [];
      for (const knowledgeId of list(task['关联知识编号'])) {
        const item = knowledge.get(knowledgeId);
        if (!item) return fail();
        usedKnowledge.add(knowledgeId);
        items.push(parse('IntakeSopKnowledge', { id: knowledgeId, title: item['标题'], body: item['正文'], audience: audience(item['可见对象']) }));
        bindResources(list(item['关联资源编号']), { graphTarget: { kind: 'knowledge', id: knowledgeId } }, items);
      }
      bindResources(list(task['关联资源编号']), { graphTarget: { kind: 'task', id: taskId } }, items);
      for (const script of scripts) {
        const entryRow = workbook.sheets['客户话术'].find(row => row.values['话术编号'] === script.entry.businessEntryId)?.values;
        if (entryRow) bindResources(list(entryRow['关联资源编号']), { entry: script.entry }, items);
      }
      const kinds = { 操作: 'action', 判断: 'decision', 结束: 'terminal' } as const;
      const kind = task['任务类型'];
      if (kind !== '操作' && kind !== '判断' && kind !== '结束') return fail();
      flow.nodes.push(parse('IntakeSopNode', { key, id: taskId, body: { kind: kinds[kind], title: task['任务名称'],
        stageLabel: task['阶段'], instruction: task['操作要求'], audience: audience(task['可见对象']),
        requirements: sorted(requirements, item => item.id), knowledge: sorted(items, item => item.id),
        scripts: sorted(scripts, item => refKey(item.entry)) } }));
      if (kind === '操作') flow.edges.push(parse('IntakeSopEdge', { key, id: `next_${digest(canonical([id, taskId]))}`, from: taskId, to: task['下一任务编号'], action: { kind: 'next' } }));
      else if (task['下一任务编号'] !== '') return fail();
      for (const branch of workbook.sheets['判断分支'].filter(row => row.values['任务编号'] === taskId).map(row => row.values)) {
        if (kind !== '判断' || !['是', '否'].includes(branch['是否无法判断'] ?? '')) return fail();
        flow.edges.push(parse('IntakeSopEdge', { key, id: branch['分支编号'], from: taskId, to: branch['目标任务编号'], action: {
          kind: 'choice', label: branch['选项'], ordinal: Number(branch['分支顺序']), matchTerms: sorted(list(branch['匹配词']), term => term),
          criterion: branch['判断依据'], unableToDetermine: branch['是否无法判断'] === '是' } }));
      }
    }
    flow.nodes = sorted(flow.nodes, node => node.id); flow.edges = sorted(flow.edges, edge => edge.id);
    flows.push(flow);
  }
  if (usedTasks.size !== tasks.size || usedResources.size !== resources.size || usedKnowledge.size !== knowledge.size
    || workbook.sheets['判断分支'].some(row => !usedTasks.has(row.values['任务编号'] ?? ''))) return fail();
  return { workbook, entries: sorted([...entries.values()], entry => entry.businessEntryId), flows, mediaOwners, resourceDisables };
}

export async function readBase(tx: IntakeTransaction, actor: Principal, sourceId: string, release: string | null): Promise<GraphBase> {
  const entries = await tx.query<{ entry: unknown }>(`SELECT e AS entry FROM content_intake.release_lineage l
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
    WHERE l.release_id=$1 AND l.source_id=$2 AND e->>'businessEntryId'=l.business_entry_id`, [release, sourceId]);
  const graphs = await tx.query<{ value: { graphs: Graph[]; versions: Record<string, number> } }>('SELECT content_intake.read_sop_graph_base($1,$2,$3) AS value', [actor.id, sourceId, release]);
  const recent = await tx.query<{ count: string }>(`SELECT coalesce(sum(c.explicit_disable_count),0) AS count
    FROM content_intake.publications p JOIN content_intake.candidate_versions c ON c.candidate_id=p.candidate_id AND c.version=p.candidate_version
    JOIN public.content_releases r ON r.release_id=p.release_id WHERE c.source_id=$1
      AND r.published_at>clock_timestamp()-interval '24 hours' AND r.published_at<=clock_timestamp()`, [sourceId]);
  let resourceHistory: ResourceHistory | null = null;
  if (intakeView() === 'resource-disable') {
    const history = await tx.query<{ value: unknown }>('SELECT content_intake.read_sop_resource_history($1,$2,$3) AS value', [actor.id, sourceId, release]);
    const raw = object(history.rows[0]?.value);
    if (raw.baseReleaseSeq !== null && !Number.isSafeInteger(raw.baseReleaseSeq) || !Array.isArray(raw.bindings)) return fail();
    resourceHistory = { baseReleaseSeq: raw.baseReleaseSeq === null ? null : Number(raw.baseReleaseSeq),
      bindings: raw.bindings.map(value => {
        const row = object(value);
        return { resourceId: parse('IntakeId', row.resourceId), binding: parseResource('IntakeResourceDisableBinding', row.binding) };
      }) };
  }
  return { resourceHistory, versions: graphs.rows[0]?.value.versions ?? {}, recentDisables: Number(recent.rows[0]!.count), entries: entries.rows.map(row => parse('IntakeEntry', row.entry)), graphs: (graphs.rows[0]?.value.graphs ?? []).map(graph => {
    validateGraph(graph); return graph;
  }) };
}

export function makeMaterial(input: { prepared: Awaited<ReturnType<typeof prepareImport>>; source: Source; base: GraphBase;
  object: C['IntakeObject']; job: Job; media: Media[]; now: number }): GraphMaterial {
  const { prepared, source, base } = input;
  const flows = new Map(base.graphs.map(graph => [graph.definition.header.key.flowId, graph.definition]));
  const media = new Map(base.graphs.flatMap(graph => graph.media).map(item => [mediaKey(item), item]));
  const sopDifferences: C['IntakeSopFlowDifference'][] = [];
  const draft = { entries: prepared.entries, media: input.media, scope: source.scope };
  for (const flow of prepared.flows) {
    const old = base.graphs.find(graph => graph.definition.header.key.flowId === flow.header.key.flowId);
    const currentMedia = input.media.filter(item => item.flowKey.flowId === flow.header.key.flowId);
    const refs = new Set([...(flow.header.anchorEntry ? [flow.header.anchorEntry] : []), ...flow.nodes.flatMap(node => node.body.scripts.map(script => script.entry))].map(refKey));
    const graph: Graph = { definition: flow, entries: sorted(draft.entries.filter(entry => refs.has(refKey({ sourceId: source.scope.sourceId, ...entry })))
      .map(entry => published(source.scope.sourceId, entry)), item => refKey({ sourceId: item.sourceId, ...item.entry })), media: sortMedia(currentMedia) };
    validateGraph(graph);
    if (!old || graphDigest(old) !== graphDigest(graph)) {
      if (old || base.versions[flow.header.key.flowId]) {
        flow.header.key.flowVersion = Math.max(old?.definition.header.key.flowVersion ?? 0, base.versions[flow.header.key.flowId] ?? 0) + 1;
        for (const node of flow.nodes) node.key = flow.header.key;
        for (const edge of flow.edges) edge.key = flow.header.key;
        for (const item of currentMedia) item.flowKey = flow.header.key;
      }
      sopDifferences.push({ sourceId: source.scope.sourceId, flowId: flow.header.key.flowId,
        change: !old ? 'add' : flow.header.operation === 'disable' ? 'disable' : old.definition.header.operation === 'disable' ? 'reenable' : 'modify',
        previousVersion: old?.definition.header.key.flowVersion ?? null, nextVersion: flow.header.key.flowVersion,
        beforeDigest: old ? graphDigest(old) : null, afterDigest: graphDigest(graph) });
    }
    flows.set(flow.header.key.flowId, flow);
    for (const [key, item] of media) if (item.flowKey.flowId === flow.header.key.flowId) media.delete(key);
    for (const item of currentMedia) media.set(mediaKey(item), item);
  }
  const previous = new Map(base.entries.map(entry => [entry.businessEntryId, entry]));
  const differences = prepared.entries.flatMap(entry => {
    const old = previous.get(entry.businessEntryId);
    return old && canonical(old) === canonical(entry) ? [] : [{ businessEntryId: entry.businessEntryId,
      change: !old ? 'add' as const : entry.operation === 'disable' ? 'disable' as const : old.operation === 'disable' ? 'reenable' as const : 'modify' as const,
      previousVersion: old?.scriptVersion ?? null, nextVersion: entry.scriptVersion,
      beforeDigest: old ? digest(canonical(old)) : null, afterDigest: digest(canonical(entry)) }];
  });
  const resourceDisables = prepared.resourceDisables.map(row => {
    if (!base.resourceHistory || !base.resourceHistory.baseReleaseSeq) return fail();
    const resourceId = row.values['资源编号'];
    const bindings = base.resourceHistory.bindings.filter(item => item.resourceId === resourceId).map(item => item.binding);
    return parseResource('IntakeResourceDisable', { key: { sourceId: source.scope.sourceId, resourceId }, operation: 'disable',
      sourceRow: { sheet: '资源与图片', row: row.row, resourceName: row.values['资源名称'], maintenanceState: '停用' },
      bindings: sortResourceBindings(bindings) });
  });
  resourceDisables.sort((a, b) => compare(a.key.resourceId, b.key.resourceId));
  if (resourceDisables.length > 100 || resourceDisables.reduce((sum, item) => sum + item.bindings.length, 0) > 5000) {
    throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  }
  const disabled = differences.filter(item => item.change === 'disable').length + sopDifferences.filter(item => item.change === 'disable').length
    + resourceDisables.length;
  const critical = object(source.graphMapping).riskLevel === 'critical' || prepared.entries.some(entry => entry.riskNote.trim())
    || base.entries.some(entry => entry.riskNote.trim()) || disabled + base.recentDisables >= 2;
  const resourceFormat = sourceGraphFormat(source) === SOP_RESOURCE_FORMAT;
  const material = { canonicalEncodingVersion: resourceFormat ? 'candidate-sop-resource-disable-v1' as const : 'candidate-sop-task-graph-v2' as const,
    scope: source.scope, sourceVersion: source.version,
    sourceClaim: parse('IntakeSourceClaim', { ...object(object(source.graphMapping).sourceClaim), fileSha256: input.object.sha256 }),
    ...(resourceFormat ? SOP_RESOURCE_FORMAT : SOP_TASK_FORMAT), selectedSheets: [...SOP_TASK_SHEETS], object: input.object, entries: prepared.entries, differences,
    contributors: sorted(input.job.contributor_ids, id => id), baseReleaseId: input.job.base_release_id,
    risk: { policyVersion: resourceFormat ? 'risk-sop-resource-disable-v1' as const : 'risk-p1.1' as const, level: critical ? 'critical' as const : 'routine' as const,
      reasons: [...(critical ? ['CRITICAL_CHANGE'] : []), ...(resourceDisables.length ? ['SOP_RESOURCE_DISABLE'] : [])],
      explicitDisableCount: disabled, sameSourceDisabledLast24Hours: base.recentDisables, evaluatedAt: new Date(input.now).toISOString() },
    sopFlows: sorted([...flows.values()], flow => flowKey(flow.header.key)), sopDifferences: sorted(sopDifferences, difference => difference.flowId),
    media: sortMedia([...media.values()]), mappingDigest: '', ...(resourceFormat ? { resourceDisables,
      resourceDisableCount: resourceDisables.length, resourceDisableSetDigest: digest(canonical(resourceDisables)),
      baseReleaseSeq: base.resourceHistory?.baseReleaseSeq ?? null } : {}) };
  material.mappingDigest = digest(canonical({ mappingVersion: material.mappingVersion, sourceVersion: material.sourceVersion, scope: material.scope,
    objectSha256: material.object.sha256, selectedSheets: material.selectedSheets, flows: material.sopFlows,
    entryRefs: material.entries.map(entry => ({ sourceId: source.scope.sourceId, businessEntryId: entry.businessEntryId, scriptVersion: entry.scriptVersion })), media: material.media }));
  const validated = parseMaterial('IntakeMaterial', material);
  if (validated.canonicalEncodingVersion !== 'candidate-sop-task-graph-v2' && validated.canonicalEncodingVersion !== 'candidate-sop-resource-disable-v1'
    || !validated.sopFlows || !validated.sopDifferences || !validated.mappingDigest) return fail();
  const result: GraphMaterial = validated.canonicalEncodingVersion === 'candidate-sop-resource-disable-v1' ? validated
    : { ...validated, canonicalEncodingVersion: 'candidate-sop-task-graph-v2',
      sopFlows: validated.sopFlows, sopDifferences: validated.sopDifferences, mappingDigest: validated.mappingDigest };
  for (const flow of result.sopFlows) graphFor(result, flow);
  const header = graphMaterialHeader(result);
  if (Buffer.byteLength(JSON.stringify(result)) > 33_554_432 || Buffer.byteLength(JSON.stringify(header)) > 262_144) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  for (const record of [...result.entries, ...result.sopFlows]) {
    if (Buffer.byteLength(JSON.stringify(record)) + Buffer.byteLength(JSON.stringify(header)) + 4096 > 1_048_576) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  }
  for (const entry of result.entries.filter(entry => entry.operation === 'upsert')) {
    const scriptId = `intake_${digest(canonical([source.scope.sourceId, entry.businessEntryId]))}`;
    const sample = { scriptId, contentHash: '0'.repeat(64), mandatory: true, entry,
      check: { scriptId, contentHash: '0'.repeat(64), defect: true, reason: '😀'.repeat(2000) } };
    if (Buffer.byteLength(JSON.stringify(sample)) > 524_288) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  }
  for (const disable of resourceDisables) {
    const target = { key: disable.key, disableDigest: digest(canonical(disable)) };
    const sample = { target, disable, check: { target, defect: true, reason: '😀'.repeat(2000) } };
    if (Buffer.byteLength(JSON.stringify(sample)) > 524_288
      || Buffer.byteLength(JSON.stringify(disable)) + Buffer.byteLength(JSON.stringify(header)) + 4096 > 1_048_576) {
      throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
    }
  }
  return result;
}

export async function freeze(tx: IntakeTransaction, actor: Principal, job: Job, source: Source, material: GraphMaterial) {
  await authorize(tx, actor, 'import', source);
  const row = await tx.query<{ value: { candidateId: string; version: number } }>(
    'SELECT content_intake.freeze_sop_graph_candidate($1,$2,$3::jsonb) AS value', [actor.id, job.job_id, JSON.stringify(material)]);
  const key = row.rows[0]?.value;
  if (!key) return fail('SOP_GRAPH_INVALID');
  return readCandidate(tx, actor, key.candidateId, key.version, 'import');
}

export async function qualityContribution(tx: IntakeTransaction, actor: Principal, key: C['IntakeCandidateKey']) {
  const rows = await tx.query<{ value: { targets: unknown[]; checks: { phase: 'initial' | 'expanded'; check: unknown }[] } }>(
    'SELECT content_intake.read_sop_graph_quality($1,$2,$3,$4) AS value', [actor.id, key.candidateId, key.version, key.digest]);
  const targets = (rows.rows[0]?.value.targets ?? []).map(target => parse('IntakeSopSopQualityTarget', target));
  const checks = (rows.rows[0]?.value.checks ?? []).map(row => ({ phase: row.phase, check: parse('IntakeSopFlowCheck', row.check) }));
  let resource: { samples: C['IntakeResourceDisableSample'][];
    checks: { phase: 'initial' | 'expanded'; check: C['IntakeResourceDisableCheck'] }[];
    plan: C['IntakeResourceDisablePlan'] } | null = null;
  if (intakeView() === 'resource-disable') {
    const result = await tx.query<{ value: { disables: unknown[];
      checks: { phase: 'initial' | 'expanded'; check: unknown }[] } }>(
      'SELECT content_intake.read_sop_resource_quality($1,$2,$3,$4) AS value', [actor.id, key.candidateId, key.version, key.digest]);
    const value = result.rows[0]?.value;
    if (!value) return fail();
    const disables = value.disables.map(item => parseResource('IntakeResourceDisable', item));
    const resourceTargets = disables.map(disable => ({ key: disable.key, disableDigest: digest(canonical(disable)) }));
    resource = { samples: disables.map((disable, index) => ({ disable, target: resourceTargets[index]!, check: null })),
      checks: value.checks.map(row => ({ phase: row.phase, check: parseResource('IntakeResourceDisableCheck', row.check) })),
      plan: { policyVersion: 'sop-resource-disable-quality-v1', materialDigest: key.digest,
        resourceDisableSetDigest: digest(canonical(disables)), targetCount: disables.length,
        targetsDigest: digest(canonical(resourceTargets)) } };
  }
  return { targets, checks, resource, sopPlan: { policyVersion: 'sop-task-graph-quality-v2' as const, materialDigest: key.digest,
    targetCount: targets.length, targetsDigest: digest(canonical(targets)) } };
}

export async function readCurrent(tx: IntakeTransaction, actor: Principal, entitlementHash: string) {
  const rows = await tx.query<{ value: { graphs: { graphDigest: string; payload: Graph }[]; validUntil: string } }>(
    'SELECT content_intake.read_sop_graph_current($1,$2) AS value', [actor.id, entitlementHash]);
  const value = rows.rows[0]?.value;
  if (!value) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
  tx.validUntil(Date.parse(value.validUntil));
  const graphs = value.graphs.map(item => {
    validateGraph(item.payload);
    return { graphDigest: parse('IntakeSopHash', item.graphDigest), payload: item.payload };
  });
  return { graphs, validUntil: Date.parse(value.validUntil) };
}

const snapshotCursorSecret = randomBytes(32);
export async function verifyGraphMedia(store: Partial<ContentAttachmentStore> | undefined, media: readonly ReservedAttachment[]): Promise<void> {
  for (const item of media) {
    if (!store?.readAttachment) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
    let bytes: Buffer;
    try { bytes = await store.readAttachment(item); } catch { throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED'); }
    if (bytes.length !== item.sizeBytes || digest(bytes) !== item.sha256) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
  }
}
export function snapshotPage(input: Pick<C['IntakeSnapshot'], 'releaseId' | 'entitlementId' | 'contextGeneration' | 'faq' | 'vocabulary'>
  & { graphs: Awaited<ReturnType<typeof readCurrent>>['graphs'] }, cursor: string | undefined, limit: number): C['IntakeSnapshot'] {
  const faq = new Map(input.faq.map(item => [canonical([item.sourceId, item.entry.businessEntryId]), item]));
  for (const graph of input.graphs) for (const entry of graph.payload.entries) {
    const key = canonical([entry.sourceId, entry.entry.businessEntryId]), previous = faq.get(key);
    if (previous && canonical(previous) !== canonical(entry)) throw new IntakeRejection('SOP_DEPENDENCY_INVALID');
    faq.set(key, entry);
  }
  const snapshot = { releaseId: input.releaseId, entitlementId: input.entitlementId, contextGeneration: input.contextGeneration,
    faq: sorted([...faq.values()], item => canonical([item.sourceId, item.entry.businessEntryId, item.entry.scriptVersion])),
    vocabulary: sorted(input.vocabulary, item => canonical([item.kind, item.id, item.displayVersion])),
    sopFlows: input.graphs.map(item => ({ header: item.payload.definition.header, graphDigest: item.graphDigest })),
    sopNodes: input.graphs.flatMap(item => item.payload.definition.nodes), sopEdges: input.graphs.flatMap(item => item.payload.definition.edges),
    media: sortMedia(input.graphs.flatMap(item => item.payload.media)) };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 33_554_432) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
  const snapshotDigest = digest(canonical(snapshot)), names = ['faq', 'vocabulary', 'sopFlows', 'sopNodes', 'sopEdges', 'media'] as const;
  const totals = { faq: snapshot.faq.length, vocabulary: snapshot.vocabulary.length, sopFlows: snapshot.sopFlows.length,
    sopNodes: snapshot.sopNodes.length, sopEdges: snapshot.sopEdges.length, media: snapshot.media.length };
  const sign = (body: string) => createHmac('sha256', snapshotCursorSecret).update(body).digest();
  const token = (page: number) => {
    const body = Buffer.from(JSON.stringify([snapshotDigest, input.entitlementId, limit, page])).toString('base64url');
    return `${body}.${sign(body).toString('base64url')}`;
  };
  const blank = () => ({ releaseId: input.releaseId, entitlementId: input.entitlementId, contextGeneration: input.contextGeneration,
    snapshotDigest, totals, pageIndex: 0, pageCount: 1024, nextCursor: null as string | null,
    faq: [] as typeof snapshot.faq, vocabulary: [] as typeof snapshot.vocabulary, sopFlows: [] as typeof snapshot.sopFlows,
    sopNodes: [] as typeof snapshot.sopNodes, sopEdges: [] as typeof snapshot.sopEdges, media: [] as typeof snapshot.media });
  const pages = [blank()];
  let records = 0, bytes = Buffer.byteLength(JSON.stringify(pages[0])) + 514;
  for (const name of names) for (const value of snapshot[name]) {
    const added = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (records >= limit || bytes + added > 1_048_576) {
      if (!records || pages.length >= 1024) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
      pages.push(blank()); records = 0; bytes = Buffer.byteLength(JSON.stringify(pages.at(-1))) + 514;
    }
    if (bytes + added > 1_048_576) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
    // Collection membership is established by the loop over the typed snapshot.
    (pages.at(-1)![name] as unknown[]).push(value);
    records++; bytes += added;
  }
  let index = 0;
  if (cursor) {
    const parts = cursor.split('.'), body = parts[0] ?? '', actual = Buffer.from(parts[1] ?? '', 'base64url'), expected = sign(body);
    if (parts.length !== 2 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new IntakeRejection('SOP_SNAPSHOT_INVALID'); }
    if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== snapshotDigest || parsed[1] !== input.entitlementId
      || parsed[2] !== limit || !Number.isInteger(parsed[3]) || parsed[3] < 1 || parsed[3] >= pages.length) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    index = parsed[3];
  }
  const result = pages[index]!;
  return parse('IntakeSnapshot', { ...result, pageIndex: index, pageCount: pages.length, nextCursor: index + 1 < pages.length ? token(index + 1) : null });
}

export function createGraphMediaReader(run: ReturnType<typeof createIntakeTransactions>, store: ContentAttachmentStore) {
  type Selection = { descriptor: ReservedAttachment; key: C['IntakeCandidateKey']; binding: C['IntakeSopCandidateMediaBinding'] };
  const decode = (raw: unknown): Selection => {
    const value = object(raw), descriptor = object(value.descriptor);
    if (typeof descriptor.objectId !== 'string' || !/^obj_[0-9a-f]{64}$/.test(descriptor.objectId)
      || typeof descriptor.sizeBytes !== 'number' || !Number.isSafeInteger(descriptor.sizeBytes) || descriptor.sizeBytes < 1 || descriptor.sizeBytes > 5_242_880
      || descriptor.mime !== 'image/png' && descriptor.mime !== 'image/jpeg' && descriptor.mime !== 'image/gif') return fail('SOP_DEPENDENCY_INVALID');
    return { descriptor: { objectId: descriptor.objectId, sha256: parse('IntakeSopHash', descriptor.sha256), sizeBytes: descriptor.sizeBytes, mime: descriptor.mime },
      key: parse('IntakeCandidateKey', value.key), binding: parse('IntakeSopCandidateMediaBinding', value.binding) };
  };
  const select = async (tx: IntakeTransaction, actor: Principal, key: C['IntakeCandidateKey'], binding: C['IntakeSopCandidateMediaBinding']): Promise<Selection> => {
    const { src } = await candidateContext(tx, actor, key, 'review', true);
    await authorize(tx, actor, 'review', src);
    const row = await tx.query<{ value: unknown }>('SELECT content_intake.read_sop_graph_candidate_media($1,$2,$3,$4,$5::jsonb) AS value',
      [actor.id, key.candidateId, key.version, key.digest, JSON.stringify(binding)]);
    const value = object(row.rows[0]?.value);
    return decode({ descriptor: value, key, binding });
  };
  return {
    async candidateMedia(actor: AuthenticatedUser, candidateId: string, version: number, objectId: string, raw: unknown) {
      const prepare = () => {
        const query = object(raw), { digest: materialDigest, ...binding } = query;
        if ('objectId' in binding) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        for (const field of ['flowVersion', 'scriptVersion']) {
          if (typeof binding[field] === 'string' && /^[1-9][0-9]*$/.test(binding[field])) binding[field] = Number(binding[field]);
        }
        return { key: parse('IntakeCandidateKey', { candidateId, version, digest: materialDigest }),
          binding: parse('IntakeSopCandidateMediaBinding', { ...binding, objectId }) };
      };
      const before = await run(actor, 'graph-candidate-media', null, null, async (tx, who) => {
        const request = prepare(); return select(tx, who, request.key, request.binding);
      }, decode);
      if (!before.ok) return before;
      let bytes: Buffer | null = null;
      try { bytes = await store.readAttachment(before.value.descriptor); } catch { /* The recheck below owns the visible unavailable result. */ }
      return run(actor, 'graph-candidate-media', null, null, async (tx, who) => {
        const current = await select(tx, who, before.value.key, before.value.binding);
        if (canonical(current) !== canonical(before.value)) throw new IntakeRejection('MATERIAL_CHANGED');
        if (!bytes || bytes.length !== current.descriptor.sizeBytes || digest(bytes) !== current.descriptor.sha256) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
        return parse('IntakeSopCandidateMediaPayload', { key: current.key, binding: current.binding,
          sha256: current.descriptor.sha256, mime: current.descriptor.mime, bytes: bytes.length, base64: bytes.toString('base64') });
      }, raw => parse('IntakeSopCandidateMediaPayload', raw));
    },
  };
}
