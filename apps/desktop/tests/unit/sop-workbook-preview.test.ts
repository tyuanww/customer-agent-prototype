import { expect, it } from 'vitest';
import { sopWorkbookPreview } from '../../src/shared/sop-workbook-preview';

it('shows accepted sheet text and drops image bytes', () => {
  const view = sopWorkbookPreview('SOP_原始下载_2026-10-03.xlsx', {
    ok: true,
    rows: [
      { sheet: '少错破SOP', row: 2, text: '索要凭证\n拍三张照片', attachmentIds: ['sop:少错破SOP:2:1'] },
      { sheet: '过敏流程SOP', row: 3, text: '泛红 / 刺痛', attachmentIds: [] },
    ],
    issues: [],
  });
  expect(view.published).toBe(false);
  expect(view.accepted).toBe(true);
  expect(view.fileName).toBe('SOP_原始下载_2026-10-03.xlsx');
  expect(view.sheets[0]).toEqual({
    name: '少错破SOP',
    lines: [{ row: 2, text: '索要凭证\n拍三张照片', images: 1 }],
  });
  expect(JSON.stringify(view)).not.toContain('base64');
});

it('hides rows when the workbook is rejected', () => {
  const view = sopWorkbookPreview('坏表.xlsx', {
    ok: false,
    rows: [{ sheet: '少错破SOP', row: 2, text: '不该出现', attachmentIds: [] }],
    issues: [{ code: 'MISSING_SHEET', sheet: '长痘痘SOP', row: 1, fix: '选择存在的 SOP 工作表' }],
  });
  expect(view.accepted).toBe(false);
  expect(view.sheets).toEqual([]);
  expect(view.issues).toEqual([{ code: 'MISSING_SHEET', sheet: '长痘痘SOP', row: 1, fix: '选择存在的 SOP 工作表' }]);
});
