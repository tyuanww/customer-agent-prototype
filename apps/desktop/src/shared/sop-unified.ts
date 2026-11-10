import type { components } from '@customer-agent/contracts/sop-resource-disable';
import { SOP_QUERY_GROUPS, isSopQueryCommand, type SopQueryGroup } from './sop-query';

export const SOP_UNIFIED_CONTRACT = 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f';
export const SOP_RESOURCE_CONTRACT = 'cs-ai-c11-openapi-1.30.1-schema-1.35-5fb5c1285056';
export type SopContractVersion = 'v11' | 'v12';
export type SopSchemas = components['schemas'];
export type SopGraphResult = SopSchemas['MenokinSopQuerySopReadyResult'];
export type SopTask = SopSchemas['IntakeSopNode'];
export type SopMedia = SopGraphResult['media'][number];
export type SopEntryRef = SopSchemas['IntakeSopEntryRef'];
export type SopUnifiedCommand =
  | { kind: 'query'; shopKey: string; group: SopQueryGroup; text: string }
  | { kind: 'confirm' | 'choose' | 'copy' | 'next' | 'media'; key: string }
  | { kind: 'media-failed'; key: string }
  | { kind: 'refresh' }
  | { kind: 'clear' };

type ProjectionBase = {
  projectionVersion: 'sop-unified-v11';
  sessionId: number;
  shops: { key: string; label: string }[];
  notice: string;
  busy: boolean;
  copied: boolean;
};
export type SopUnifiedNode = {
  title: string;
  stage: string;
  instruction: string;
  kind: 'action' | 'decision' | 'terminal';
  requirements: {
    key: string;
    label: string;
    ordinal: number;
    confirmed: boolean;
  }[];
  scripts: {
    key: string;
    title: string;
    body: string;
    relation: 'independent' | 'alternative' | 'complementary';
    condition: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    canCopy: boolean;
  }[];
  knowledge: {
    title: string;
    body: string;
    resource: string | null;
    owner: 'task' | 'knowledge' | null;
  }[];
  media: ({
    key: string;
    alt: string;
    owner: 'entry' | 'task' | 'knowledge';
    required: boolean;
  } & (
    | { state: 'loading' | 'unavailable'; image: null }
    | { state: 'ready'; image: string }
  ))[];
  choices: {
    key: string;
    label: string;
    criterion: string;
    unableToDetermine: boolean;
    ordinal: number;
  }[];
  canAdvance: boolean;
  nextKey: string;
};
export type SopUnifiedProjection = ProjectionBase & (
  | { state: 'ready'; title: string; node: SopUnifiedNode }
  | {
    state: 'idle' | 'loading' | 'blocked' | 'stale' | 'no_match' | 'paused' | 'closing' | 'ended' | 'failed';
    node: null;
    title: '';
  }
);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, names: string[]) {
  return Object.keys(value).length === names.length && names.every(name => name in value);
}
function string(value: unknown, max = 32768): value is string {
  return typeof value === 'string' && value.length <= max;
}
function array(value: unknown, max: number, valid: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= max && value.every(valid);
}
export function isSopUnifiedCommand(value: unknown): value is SopUnifiedCommand {
  if (isSopQueryCommand(value)) return true;
  if (!record(value)) return false;
  if (value.kind === 'refresh') return exact(value, ['kind']);
  return ['confirm', 'next', 'media', 'media-failed'].includes(String(value.kind))
    && exact(value, ['kind', 'key'])
    && string(value.key, 128)
    && value.key.length > 0;
}

/** Renderer projections contain only display text, verified images and ephemeral action keys. */
export function isSopUnifiedProjection(value: unknown): value is SopUnifiedProjection {
  if (!record(value)
    || !exact(value, ['projectionVersion', 'sessionId', 'shops', 'notice', 'busy', 'copied', 'state', 'title', 'node'])
    || value.projectionVersion !== 'sop-unified-v11'
    || !Number.isSafeInteger(value.sessionId)
    || Number(value.sessionId) < 1
    || !string(value.notice)
    || typeof value.busy !== 'boolean'
    || typeof value.copied !== 'boolean'
    || !array(value.shops, 1000, shop => record(shop)
      && exact(shop, ['key', 'label'])
      && string(shop.key, 128)
      && string(shop.label, 512))) {
    return false;
  }
  if (value.state !== 'ready') {
    return ['idle', 'loading', 'blocked', 'stale', 'no_match', 'paused', 'closing', 'ended', 'failed'].includes(String(value.state))
      && value.node === null
      && value.title === ''
      && !value.copied;
  }
  const node = value.node;
  return string(value.title, 512)
    && record(node)
    && exact(node, [
      'title', 'stage', 'instruction', 'kind', 'requirements', 'scripts', 'knowledge',
      'media', 'choices', 'canAdvance', 'nextKey',
    ])
    && string(node.title, 512)
    && string(node.stage, 512)
    && string(node.instruction)
    && ['action', 'decision', 'terminal'].includes(String(node.kind))
    && typeof node.canAdvance === 'boolean'
    && string(node.nextKey, 128)
    && array(node.requirements, 32, requirement => record(requirement)
      && exact(requirement, ['key', 'label', 'ordinal', 'confirmed'])
      && string(requirement.key, 128)
      && string(requirement.label, 2048)
      && Number.isSafeInteger(requirement.ordinal)
      && Number(requirement.ordinal) > 0
      && typeof requirement.confirmed === 'boolean')
    && array(node.scripts, 256, script => record(script)
      && exact(script, ['key', 'title', 'body', 'relation', 'condition', 'risk', 'canCopy'])
      && string(script.key, 128)
      && string(script.title, 512)
      && string(script.body)
      && string(script.condition)
      && ['independent', 'alternative', 'complementary'].includes(String(script.relation))
      && ['low', 'medium', 'high', 'critical'].includes(String(script.risk))
      && typeof script.canCopy === 'boolean')
    && array(node.knowledge, 128, knowledge => record(knowledge)
      && exact(knowledge, ['title', 'body', 'resource', 'owner'])
      && string(knowledge.title, 512)
      && string(knowledge.body)
      && (knowledge.resource === null || string(knowledge.resource, 256))
      && (knowledge.owner === null || knowledge.owner === 'task' || knowledge.owner === 'knowledge'))
    && array(node.media, 500, media => record(media)
      && exact(media, ['key', 'alt', 'owner', 'required', 'state', 'image'])
      && string(media.key, 128)
      && string(media.alt, 1024)
      && ['entry', 'task', 'knowledge'].includes(String(media.owner))
      && typeof media.required === 'boolean'
      && ['loading', 'ready', 'unavailable'].includes(String(media.state))
      && (media.state === 'ready' ? media.image !== null : media.image === null)
      && (media.image === null || (typeof media.image === 'string'
        && media.image.length <= 7_000_000
        && /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(media.image))))
    && array(node.choices, 4, choice => record(choice)
      && exact(choice, ['key', 'label', 'criterion', 'unableToDetermine', 'ordinal'])
      && string(choice.key, 128)
      && string(choice.label, 512)
      && string(choice.criterion)
      && typeof choice.unableToDetermine === 'boolean'
      && Number.isSafeInteger(choice.ordinal)
      && Number(choice.ordinal) > 0);
}
export { SOP_QUERY_GROUPS };
