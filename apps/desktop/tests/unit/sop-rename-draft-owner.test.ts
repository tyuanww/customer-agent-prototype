import { describe, expect, it } from 'vitest';
import { SopRenameDraftOwner } from '../../src/main/sop-rename-draft-owner';

describe('SOP step rename drafts', () => {
  it('retains independent editing state and rejects delayed updates', () => {
    const drafts = new SopRenameDraftOwner();
    const first = drafts.start('a', 1, '流程甲');
    const other = drafts.start('b', 4, null);
    expect(drafts.update('a', first.draftId, 1, '客户甲')).toBe(true);
    expect(drafts.update('a', first.draftId, 3, '客户甲新')).toBe(true);
    expect(drafts.update('a', first.draftId, 2, '旧输入')).toBe(false);
    expect(drafts.current('a')).toMatchObject({ revision: 1, initialName: '流程甲', value: '客户甲新', sequence: 3 });
    expect(drafts.current('b')).toEqual(other);
    expect(drafts.start('a', 1, '流程甲')).toMatchObject({ draftId: first.draftId, value: '客户甲新' });
  });

  it('cannot resurrect a cancelled draft or clear a newer edit', () => {
    const drafts = new SopRenameDraftOwner();
    const first = drafts.start('a', 1, null);
    expect(drafts.discard('a', first.draftId)).toBe(true);
    const second = drafts.start('a', 1, null);
    expect(second.draftId).not.toBe(first.draftId);
    expect(drafts.update('a', first.draftId, 1, '迟到')).toBe(false);
    expect(drafts.discard('a', first.draftId)).toBe(false);
    expect(drafts.current('a')).toEqual(second);
    drafts.clear('a');
    expect(drafts.current('a')).toBeNull();
  });
});
