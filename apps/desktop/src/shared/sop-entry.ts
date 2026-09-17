import { analyzeQuery, compactQueryText } from './query-analyze';

export const ALLERGY_SOP_SCENE_ID = 'allergy-aftersale-demo';

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
