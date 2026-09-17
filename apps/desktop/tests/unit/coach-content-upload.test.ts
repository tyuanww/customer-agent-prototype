import { describe, expect, it } from 'vitest';
import { DASHBOARD_MANIFEST } from '../../src/renderer/data/dashboard-manifest';
import {
  COACH_UPLOAD_MAX_BYTES,
  COACH_UPLOAD_MAX_ROWS,
  parseCoachUploadCsv,
  readCoachUploadFile,
} from '../../src/renderer/features/dashboard/coach-content-upload';

describe('coach content upload parser', () => {
  it('parses the compile-time demo csv into scene/script staged rows', () => {
    const result = parseCoachUploadCsv(
      DASHBOARD_MANIFEST.content.upload.demoCsv,
      DASHBOARD_MANIFEST.content.upload.demoFileName,
    );
    expect(result).toMatchObject({
      ok: true,
      sourceName: 'synthetic-coach-draft.csv',
    });
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { scene: '洁面用量确认', script: '先确认产品版本，再说明用量与不可承诺边界' },
      { scene: '满赠规则说明', script: '展示门槛与结算条件，不承诺库存' },
      { scene: '售后质量升级', script: '记录必要证据，禁止原因承诺' },
    ]);
  });

  it('accepts quoted commas, chinese headers, step aliases, and optional domain', () => {
    const canonical = parseCoachUploadCsv(
      '场景,标准话术,域\n"洁面,用量",先确认版本,product\n',
      'quoted.csv',
    );
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    expect(canonical.rows).toEqual([
      { scene: '洁面,用量', script: '先确认版本', domain: 'product' },
    ]);

    const alias = parseCoachUploadCsv('scene,step\n满赠说明,不承诺库存\n', 'alias.csv');
    expect(alias).toMatchObject({
      ok: true,
      rows: [{ scene: '满赠说明', script: '不承诺库存' }],
    });
  });

  it('fail-closes missing headers, empty tables, and invalid domains', () => {
    expect(parseCoachUploadCsv('title,body\nA,B\n', 'bad.csv')).toMatchObject({
      ok: false,
      code: 'invalid-table',
    });
    expect(parseCoachUploadCsv('scene,step\n\n', 'empty.csv')).toMatchObject({
      ok: false,
      code: 'empty',
    });
    const badDomain = parseCoachUploadCsv('scene,step,domain\n用量,说明,legal\n', 'domain.csv');
    expect(badDomain).toMatchObject({
      ok: false,
      code: 'invalid-table',
    });
    if (badDomain.ok) return;
    expect(badDomain.message).toContain('第 2 行');
  });

  it('fail-closes rows above the local row cap and rows missing a scene or script cell', () => {
    const overCap = [
      'scene,script',
      ...Array.from({ length: COACH_UPLOAD_MAX_ROWS + 1 }, (_, index) => `场景${index},话术${index}`),
    ].join('\n');
    const overCapResult = parseCoachUploadCsv(overCap, 'over-cap.csv');
    expect(overCapResult).toMatchObject({ ok: false, code: 'invalid-table' });
    if (overCapResult.ok) return;
    expect(overCapResult.message).toContain(`${COACH_UPLOAD_MAX_ROWS} 行`);
    expect(overCapResult.message).toContain('上限');

    const atCap = [
      'scene,script',
      ...Array.from({ length: COACH_UPLOAD_MAX_ROWS }, (_, index) => `场景${index},话术${index}`),
    ].join('\n');
    const atCapResult = parseCoachUploadCsv(atCap, 'at-cap.csv');
    expect(atCapResult.ok).toBe(true);
    if (!atCapResult.ok) return;
    expect(atCapResult.rows).toHaveLength(COACH_UPLOAD_MAX_ROWS);

    const noScene = parseCoachUploadCsv('scene,script\n,先确认版本\n', 'no-scene.csv');
    expect(noScene).toMatchObject({ ok: false, code: 'invalid-table' });
    if (noScene.ok) return;
    expect(noScene.message).toContain('第 2 行');
    const noScript = parseCoachUploadCsv('scene,script\n洁面用量确认,\n', 'no-script.csv');
    expect(noScript).toMatchObject({ ok: false, code: 'invalid-table' });
    if (noScript.ok) return;
    expect(noScript.message).toContain('第 2 行');
    expect(parseCoachUploadCsv('﻿scene,script\r\n洁面,先确认版本\r\n', 'bom.csv')).toMatchObject({
      ok: true,
      rows: [{ scene: '洁面', script: '先确认版本' }],
    });
  });

  it('reads csv and csv-shaped xlsx files in the renderer without treating zip workbooks as staged', async () => {
    const csv = await readCoachUploadFile(new File(
      ['scene,step\n用量确认,先确认版本\n'],
      'draft.csv',
      { type: 'text/csv' },
    ));
    expect(csv).toMatchObject({
      ok: true,
      sourceName: 'draft.csv',
      rows: [{ scene: '用量确认', script: '先确认版本' }],
    });

    const xlsxText = await readCoachUploadFile(new File(
      ['scene,script\n满赠说明,不承诺库存\n'],
      'draft.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ));
    expect(xlsxText).toMatchObject({
      ok: true,
      sourceName: 'draft.xlsx',
      rows: [{ scene: '满赠说明', script: '不承诺库存' }],
    });

    const zip = await readCoachUploadFile(new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
      'workbook.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ));
    expect(zip).toMatchObject({ ok: false, code: 'binary-workbook' });
    if (zip.ok) return;
    expect(zip.message).toContain('未连接飞书或 Wiki');

    const huge = await readCoachUploadFile(new File(
      ['x'.repeat(COACH_UPLOAD_MAX_BYTES + 1)],
      'huge.csv',
      { type: 'text/csv' },
    ));
    expect(huge).toMatchObject({ ok: false, code: 'too-large' });
    if (huge.ok) return;
    expect(huge.message).toContain(`${COACH_UPLOAD_MAX_BYTES / 1024}KiB`);

    const other = await readCoachUploadFile(new File(['scene,step\nA,B\n'], 'notes.txt'));
    expect(other).toMatchObject({ ok: false, code: 'unsupported-type' });
  });
});
