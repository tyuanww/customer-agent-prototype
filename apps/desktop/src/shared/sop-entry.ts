import { analyzeQuery, compactQueryText } from './query-analyze';

export const ALLERGY_SOP_SCENE_ID = 'allergy-aftersale-demo';
export type SopEntry = Readonly<{ sceneId: string; title: string }>;

const SYNTHETIC_SCRIPT_SOPS: ReadonlyMap<string, readonly string[]> = new Map([
  ['syn-after-002', [ALLERGY_SOP_SCENE_ID]],
]);

export function relatedSyntheticSopEntries({ scriptId, entries }: { scriptId: string; entries: readonly SopEntry[] }): readonly SopEntry[] {
  const sceneIds = SYNTHETIC_SCRIPT_SOPS.get(scriptId);
  return sceneIds ? entries.filter(entry => sceneIds.includes(entry.sceneId)) : [];
}

const USAGE_MARKERS = Object.freeze([
  '怎么用',
  '如何用',
  '怎样用',
  '用法',
  '咋用',
  '咋使',
  '使用步骤',
  '使用频率',
]);

export function isAllergySopEntry(compactQuery: string): boolean {
  const compact = compactQueryText(compactQuery);
  if (!compact.includes('过敏')) {
    return false;
  }
  if (USAGE_MARKERS.some((marker) => compact.includes(compactQueryText(marker)))) {
    return false;
  }
  const slots = analyzeQuery(compactQuery);
  return slots.domain === 'aftersale' && slots.entities.some((entity) => entity.includes('过敏'));
}

export const MISSING_ITEM_SOP_SCENE_ID = 'missing-item-demo';
export function findSopEntries(query: string): readonly SopEntry[] {
  const entries: SopEntry[] = [];
  if (isAllergySopEntry(query)) entries.push({ sceneId: ALLERGY_SOP_SCENE_ID, title: '过敏流程' });
  if (/少件|漏发|少发|没收到全部/.test(compactQueryText(query))) entries.push({ sceneId: MISSING_ITEM_SOP_SCENE_ID, title: '少件处理' });
  return entries;
}
