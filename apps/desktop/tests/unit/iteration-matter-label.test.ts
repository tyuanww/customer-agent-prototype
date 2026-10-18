import { describe, expect, it } from 'vitest';
import { iterationMatterLabel } from '../../src/shared/dashboard-iteration';

describe('iterationMatterLabel', () => {
  it('names a storewide miss by channel', () => {
    expect(iterationMatterLabel('no_hit:none:storewide:douyin')).toBe('抖音全店没有命中话术');
    expect(iterationMatterLabel('no_hit:none:storewide:qianniu')).toBe('千牛全店没有命中话术');
  });

  it('keeps a product name when the miss is not storewide', () => {
    expect(iterationMatterLabel('no_hit:sku:面膜紫:douyin')).toBe('抖音面膜紫没有命中话术');
  });

  it('does not show a machine key for skipped, stale, or unknown clusters', () => {
    expect(iterationMatterLabel('top1_skipped:script-a')).toBe('没有采用排在第一的话术');
    expect(iterationMatterLabel('stale:script-a')).toBe('有话术已过期');
    expect(iterationMatterLabel('script-a')).toBe('待处理事项');
    expect(iterationMatterLabel('no_hit:none:storewide:douyin')).not.toContain('no_hit');
  });
});
