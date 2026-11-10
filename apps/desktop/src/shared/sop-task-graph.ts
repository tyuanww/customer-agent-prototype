import type { SopEntryRef, SopGraphResult, SopMedia, SopSchemas, SopTask } from './sop-unified';

export function sopEntryKey(entry: SopEntryRef): string {
  return JSON.stringify([entry.sourceId, entry.businessEntryId, entry.scriptVersion]);
}

export function sopMediaKey(media: SopMedia): string {
  const binding = media.binding;
  return JSON.stringify([
    binding.flowKey.sourceId,
    binding.flowKey.flowId,
    binding.flowKey.flowVersion,
    binding.entry ? 'entry' : binding.graphTarget?.kind,
    binding.entry?.businessEntryId ?? binding.graphTarget?.id,
    binding.entry?.scriptVersion ?? null,
    binding.resourceId,
    binding.objectId,
    binding.ordinal,
  ]);
}

export function sameFlow(a: SopSchemas['IntakeSopFlowKey'], b: SopSchemas['IntakeSopFlowKey']): boolean {
  return a.sourceId === b.sourceId && a.flowId === b.flowId && a.flowVersion === b.flowVersion;
}

function consecutive(values: number[]): boolean {
  return values.slice().sort((a, b) => a - b).every((value, index) => value === index + 1);
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function safeAllergy(title: string, body: string): boolean {
  return !(title.includes('过敏') || body.includes('过敏')) || (body.includes('停手') && body.includes('确认'));
}

/** Validated graph and progress stay in Main. No sequence, risk or edge is inferred. */
export class SopTaskGraph {
  readonly nodes: Map<string, SopTask>;
  readonly entries: Map<string, SopGraphResult['entries'][number]['entry']>;
  readonly permissions: Map<string, SopGraphResult['permissions'][number]>;
  private currentId: string;
  private readonly confirmations = new Map<string, Set<string>>();

  constructor(readonly result: SopGraphResult, role: 'agent' | 'coach' | 'owner') {
    const { flow, entries, permissions, media } = result;
    const key = flow.header.key;
    this.nodes = new Map(flow.nodes.map(node => [node.id, node]));
    this.currentId = flow.header.startNodeId;
    this.entries = new Map(entries.map(row => [sopEntryKey({ sourceId: row.sourceId, ...row.entry }), row.entry]));
    this.permissions = new Map(permissions.map(permission => [sopEntryKey(permission.entry), permission]));
    const allowedAudience = (audience: string) => audience !== 'coach'
      || (role !== 'agent' && flow.header.audience === 'coach');
    if (flow.header.operation !== 'upsert'
      || !allowedAudience(flow.header.audience)
      || !this.nodes.has(this.currentId)
      || this.nodes.size !== flow.nodes.length
      || this.entries.size !== entries.length
      || this.permissions.size !== permissions.length
      || !unique(flow.edges.map(edge => edge.id))
      || !flow.header.entryTerms.length) {
      throw new Error('SOP_GRAPH_INVALID');
    }
    const requiredEntries = new Set<string>();
    const knowledgeContent = new Map<string, string>();
    if (flow.header.anchorEntry) requiredEntries.add(sopEntryKey(flow.header.anchorEntry));
    for (const node of flow.nodes) {
      const body = node.body;
      const outgoing = flow.edges.filter(edge => edge.from === node.id);
      if (!sameFlow(node.key, key)
        || !allowedAudience(body.audience)
        || !safeAllergy(body.title, body.instruction)
        || !unique(body.requirements.map(item => item.id))
        || !consecutive(body.requirements.map(item => item.ordinal))
        || !unique(body.knowledge.map(item => item.id))
        || !unique(body.scripts.map(item => sopEntryKey(item.entry)))) {
        throw new Error('SOP_GRAPH_INVALID');
      }
      for (const knowledge of body.knowledge) {
        if (!allowedAudience(knowledge.audience)) throw new Error('SOP_GRAPH_INVALID');
        const canonical = JSON.stringify([knowledge.title, knowledge.body, knowledge.audience]);
        const previous = knowledgeContent.get(knowledge.id);
        if (previous !== undefined && previous !== canonical) throw new Error('SOP_DEPENDENCY_INVALID');
        knowledgeContent.set(knowledge.id, canonical);
        const binding = knowledge.resourceBinding;
        if (!binding) continue;
        if (knowledge.id !== binding.resourceId) throw new Error('SOP_DEPENDENCY_INVALID');
        if (binding.ownerKind === 'task') {
          if (binding.ownerId !== node.id) throw new Error('SOP_DEPENDENCY_INVALID');
        } else {
          const owner = body.knowledge.find(item => item.id === binding.ownerId);
          if (!owner || owner.resourceBinding) throw new Error('SOP_DEPENDENCY_INVALID');
        }
      }
      for (const script of body.scripts) requiredEntries.add(sopEntryKey(script.entry));
      if (body.kind === 'terminal' && outgoing.length !== 0) throw new Error('SOP_GRAPH_INVALID');
      if (body.kind === 'action' && (outgoing.length !== 1 || outgoing[0]?.action.kind !== 'next')) {
        throw new Error('SOP_GRAPH_INVALID');
      }
      if (body.kind === 'decision') {
        const choices = outgoing.map(edge => edge.action).filter(action => action.kind === 'choice');
        if (choices.length !== outgoing.length
          || choices.length < 2
          || choices.length > 4
          || !unique(choices.map(choice => choice.label))
          || !consecutive(choices.map(choice => choice.ordinal))
          || choices.filter(choice => choice.unableToDetermine).length !== 1
          || choices.some(choice => !choice.criterion.trim())) {
          throw new Error('SOP_GRAPH_INVALID');
        }
      }
    }
    if (requiredEntries.size !== this.entries.size || this.permissions.size !== this.entries.size) {
      throw new Error('SOP_DEPENDENCY_INVALID');
    }
    for (const ref of requiredEntries) {
      const entry = this.entries.get(ref);
      const permission = this.permissions.get(ref);
      if (!entry || !permission
        || permission.entry.sourceId !== key.sourceId
        || !safeAllergy(entry.title, entry.answerText)) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
    }
    if (entries.some(row => row.sourceId !== key.sourceId)) throw new Error('SOP_DEPENDENCY_INVALID');
    for (const edge of flow.edges) {
      if (!sameFlow(edge.key, key) || !this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
        throw new Error('SOP_GRAPH_INVALID');
      }
    }
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('SOP_GRAPH_INVALID');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const edge of flow.edges.filter(edge => edge.from === id)) visit(edge.to);
      visiting.delete(id);
      visited.add(id);
    };
    visit(this.currentId);
    if (visited.size !== this.nodes.size) throw new Error('SOP_GRAPH_INVALID');
    const mediaBindings = new Set<string>();
    const ownerOrdinals = new Set<string>();
    const mediaObjects = new Map<string, string>();
    for (const item of media) {
      const binding = item.binding;
      if (!sameFlow(binding.flowKey, key) || !allowedAudience(binding.audience)) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
      if (binding.entry && (!this.entries.has(sopEntryKey(binding.entry)) || binding.audience !== 'customer')) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
      if (binding.graphTarget?.kind === 'task' && !this.nodes.has(binding.graphTarget.id)) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
      if (binding.graphTarget?.kind === 'knowledge' && !knowledgeContent.has(binding.graphTarget.id)) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
      const owner = [
        binding.entry ? 'entry' : binding.graphTarget?.kind,
        binding.entry?.businessEntryId ?? binding.graphTarget?.id,
      ];
      const ownerKey = [key.sourceId, key.flowId, key.flowVersion, ...owner];
      const association = JSON.stringify([...ownerKey, binding.resourceId, binding.objectId]);
      const position = JSON.stringify([...ownerKey, binding.ordinal]);
      if (mediaBindings.has(association) || ownerOrdinals.has(position)) {
        throw new Error('SOP_DEPENDENCY_INVALID');
      }
      mediaBindings.add(association);
      ownerOrdinals.add(position);
      const objectContent = JSON.stringify([binding.sha256, binding.mime, binding.bytes]);
      const previous = mediaObjects.get(binding.objectId);
      if (previous !== undefined && previous !== objectContent) throw new Error('SOP_DEPENDENCY_INVALID');
      mediaObjects.set(binding.objectId, objectContent);
    }
  }

  current(): SopTask {
    return this.nodes.get(this.currentId)!;
  }

  requirements() {
    return this.current().body.requirements.slice().sort((a, b) => a.ordinal - b.ordinal);
  }

  confirmed(id: string): boolean {
    return this.confirmations.get(this.currentId)?.has(id) ?? false;
  }

  confirm(id: string): boolean {
    if (!this.current().body.requirements.some(item => item.id === id)) return false;
    const set = this.confirmations.get(this.currentId) ?? new Set<string>();
    set.add(id);
    this.confirmations.set(this.currentId, set);
    return true;
  }

  complete(): boolean {
    return this.requirements().every(item => this.confirmed(item.id));
  }

  edges() {
    return this.result.flow.edges.filter(edge => edge.from === this.currentId);
  }

  advance(edgeId: string): boolean {
    const edge = this.edges().find(item => item.id === edgeId);
    if (!this.complete() || !edge) return false;
    this.currentId = edge.to;
    return true;
  }

  media(): SopMedia[] {
    const node = this.current();
    return this.result.media.filter(({ binding }) => {
      if (binding.entry) {
        const entryKey = sopEntryKey(binding.entry);
        const anchor = this.result.flow.header.anchorEntry;
        return (anchor !== null && sopEntryKey(anchor) === entryKey)
          || node.body.scripts.some(script => sopEntryKey(script.entry) === entryKey);
      }
      if (binding.graphTarget?.kind === 'task') return binding.graphTarget.id === node.id;
      return node.body.knowledge.some(knowledge => knowledge.id === binding.graphTarget?.id);
    }).sort((a, b) => a.binding.ordinal - b.binding.ordinal);
  }
}
