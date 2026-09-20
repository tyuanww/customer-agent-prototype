import { afterEach, describe, expect, it } from 'vitest';
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

  it('maps 快捷短语/产品话术 and skips blank padding rows', () => {
    const padding = Array.from({ length: 93 }, () => ',,');
    const result = parseCoachUploadCsv(
      [' ,快捷短语,产品话术', '30秒泡泡面膜,面膜紫适用人群,亲亲这是话术', ...padding].join('\n'),
      '【FAQ】MENOKIN话术.xlsx',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { scene: '30秒泡泡面膜 · 面膜紫适用人群', script: '亲亲这是话术', domain: 'product' },
    ]);
  });

  it('maps 业务填写问题/客满话术 and filename FAQ domain', () => {
    const result = parseCoachUploadCsv(
      '分类,产品,业务填写问题,客满话术|已审核\n,ALL 共性问题,需要清洗吗？,亲亲这是免洗\n',
      '【FAQ】menokin产品QA&话术.xlsx',
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [{ scene: 'ALL 共性问题 · 需要清洗吗？', script: '亲亲这是免洗', domain: 'product' }],
    });
  });

  it('maps two-column 售前/售后 files from the filename domain', () => {
    const presale = parseCoachUploadCsv('快捷短语,产品话术\n到货时效,预计3-5天到货\n', '【售前】MENOKIN话术.xlsx');
    expect(presale).toMatchObject({
      ok: true,
      rows: [{ scene: '到货时效', script: '预计3-5天到货', domain: 'presale' }],
    });
    const aftersale = parseCoachUploadCsv('快捷短语,产品话术\n试用不支持,暂时不支持试用装\n', '【售后】MENOKIN话术.xlsx');
    expect(aftersale).toMatchObject({
      ok: true,
      rows: [{ scene: '试用不支持', script: '暂时不支持试用装', domain: 'aftersale' }],
    });
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
    expect(noScene).toMatchObject({ ok: false, code: 'empty' });
    const mixed = parseCoachUploadCsv(
      'scene,script\n洁面用量确认,先确认版本\n,缺场景\n用量说明,\n',
      'skip-incomplete.csv',
    );
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.rows).toEqual([{ scene: '洁面用量确认', script: '先确认版本' }]);
    expect(mixed.sourceName).toContain('已跳过空白或不完整 2 行');
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
    expect(zip.message).toContain('Excel 需工作台主进程解析');

    const huge = await readCoachUploadFile(new File(
      ['x'.repeat(COACH_UPLOAD_MAX_BYTES + 1)],
      'huge.csv',
      { type: 'text/csv' },
    ));
    expect(huge).toMatchObject({ ok: false, code: 'too-large' });
    if (huge.ok) return;
    expect(huge.message).toContain('10MiB');

    const other = await readCoachUploadFile(new File(['scene,step\nA,B\n'], 'notes.txt'));
    expect(other).toMatchObject({ ok: false, code: 'unsupported-type' });
  });

  it('maps 活动/产品 filenames, chinese domain cells, 分类 fallback, and product=shortcut', () => {
    const campaign = parseCoachUploadCsv('快捷短语,产品话术\n满赠,不承诺库存\n', '【活动】MENOKIN话术.xlsx');
    expect(campaign).toMatchObject({
      ok: true,
      rows: [{ scene: '满赠', script: '不承诺库存', domain: 'campaign' }],
    });
    const productFile = parseCoachUploadCsv('快捷短语,产品话术\n适用人群,亲亲这是话术\n', '产品话术.xlsx');
    expect(productFile).toMatchObject({
      ok: true,
      rows: [{ scene: '适用人群', script: '亲亲这是话术', domain: 'product' }],
    });
    const chineseDomain = parseCoachUploadCsv(
      '问题,步骤,域\n需要清洗吗？,亲亲这是免洗,产品话术\n到货时效,预计3-5天,售前\n',
      'mixed.csv',
    );
    expect(chineseDomain).toMatchObject({
      ok: true,
      rows: [
        { scene: '需要清洗吗？', script: '亲亲这是免洗', domain: 'product' },
        { scene: '到货时效', script: '预计3-5天', domain: 'presale' },
      ],
    });
    const fallback = parseCoachUploadCsv(
      '分类,快捷短语,产品话术\n未知分类,到货时效,预计3-5天到货\n',
      '【售前】MENOKIN话术.xlsx',
    );
    expect(fallback).toMatchObject({
      ok: true,
      rows: [{ scene: '到货时效', script: '预计3-5天到货', domain: 'presale' }],
    });
    const sameProduct = parseCoachUploadCsv(
      ' ,快捷短语,产品话术\n面膜紫,面膜紫,亲亲这是话术\n',
      '【FAQ】MENOKIN话术.xlsx',
    );
    expect(sameProduct).toMatchObject({
      ok: true,
      rows: [{ scene: '面膜紫', script: '亲亲这是话术', domain: 'product' }],
    });
  });

  it('keeps {订单号}/{日期} and skips other braces without failing the whole table', () => {
    const mixed = parseCoachUploadCsv(
      'scene,script\n可替换,订单{订单号}于{日期}发出\n非法,含{其他}占位\n',
      'braces.csv',
    );
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.rows).toEqual([{ scene: '可替换', script: '订单{订单号}于{日期}发出' }]);
    expect(mixed.sourceName).toContain('花括号 1 行');
    const allBad = parseCoachUploadCsv('scene,script\n非法,含{其他}占位\n', 'all-braces.csv');
    expect(allBad).toMatchObject({ ok: false, code: 'empty' });
    if (allBad.ok) return;
    expect(allBad.message).toContain('合同不允许的花括号');
  });

  describe('readCoachUploadFile parseUpload bridge', () => {
    afterEach(() => {
      delete window.dashboardContent;
    });

    it('forwards zip xlsx to parseUpload and maps IPC failures onto coach codes', async () => {
      const zipFile = () => new File(
        [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
        'faq.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      );

      window.dashboardContent = {
        session: async () => ({ ok: true, enabled: true, signedIn: true, role: 'coach' }),
        parseUpload: async () => ({
          ok: true,
          sourceName: 'faq.xlsx',
          rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const }],
          csvText: 'scene,script,domain\n面膜紫适用人群,亲亲这是话术,product',
        }),
        importDraft: async () => ({ ok: false, code: 'UNAVAILABLE' as const, message: '服务暂不可用，请重试' }),
        publishDraft: async () => ({ ok: false, code: 'UNAVAILABLE' as const, message: '服务暂不可用，请重试' }),
      };
      const ok = await readCoachUploadFile(zipFile());
      expect(ok).toMatchObject({
        ok: true,
        sourceName: 'faq.xlsx',
        rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' }],
      });

      window.dashboardContent.parseUpload = async () => ({
        ok: false,
        code: 'too-large',
        message: '文件超过 10MiB。',
      });
      expect(await readCoachUploadFile(zipFile())).toMatchObject({ ok: false, code: 'too-large' });

      window.dashboardContent.parseUpload = async () => ({
        ok: false,
        code: 'empty',
        message: '没有可预览的数据行。',
      });
      expect(await readCoachUploadFile(zipFile())).toMatchObject({ ok: false, code: 'empty' });

      window.dashboardContent.parseUpload = async () => ({
        ok: false,
        code: 'FORBIDDEN',
        message: '当前身份不能执行此操作',
      });
      const forbidden = await readCoachUploadFile(zipFile());
      expect(forbidden).toMatchObject({ ok: false, code: 'binary-workbook' });
      if (forbidden.ok) return;
      expect(forbidden.message).toBe('当前身份不能执行此操作');

      window.dashboardContent.parseUpload = async () => ({
        ok: true,
        sourceName: 'faq.xlsx',
        csvText: 'x',
      } as never);
      const malformed = await readCoachUploadFile(zipFile());
      expect(malformed).toMatchObject({ ok: false, code: 'binary-workbook' });
      if (malformed.ok) return;
      expect(malformed.message).toContain('当前切片只在本页读取 CSV');
    });
  });
});
