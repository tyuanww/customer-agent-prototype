import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_MANIFEST,
  DASHBOARD_MODULE_IDS,
  DASHBOARD_NAV,
  listOpenP0IterationTasks,
  nextDashboardNavId,
} from '../../src/renderer/data/dashboard-manifest';

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/data/dashboard-manifest.ts',
);

describe('dashboard manifest', () => {
  it('is deeply frozen compile-time data with five decision-oriented modules', () => {
    expect(DASHBOARD_MODULE_IDS).toHaveLength(5);
    expect(DASHBOARD_NAV.map((item) => item.id)).toEqual([...DASHBOARD_MODULE_IDS]);
    expect(Object.isFrozen(DASHBOARD_MANIFEST)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.ledger.rows)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.overview.metrics[0])).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.wording.entries)).toBe(true);
  });

  it('places SOP in 话术运营 between wording and content', () => {
    expect(DASHBOARD_MODULE_IDS).toEqual([
      'overview',
      'wording',
      'sop',
      'content',
      'announce',
    ]);
    expect(DASHBOARD_NAV.find((item) => item.id === 'sop')).toEqual({
      id: 'sop',
      label: 'SOP',
      blurb: '过敏流程只读合成树',
      group: '话术运营',
    });
    expect(DASHBOARD_NAV.filter((item) => item.group === '话术运营').map((item) => item.id)).toEqual([
      'wording',
      'sop',
    ]);
    expect(nextDashboardNavId('sop', 1)).toBe('content');
    expect(nextDashboardNavId('sop', -1)).toBe('wording');
  });

  it('does not invent live timestamps or persist anything', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/localStorage|IndexedDB|indexedDB/);
    expect(DASHBOARD_MANIFEST.banners.refreshedAt).toBe('2026-08-13 18:40:00 CST');
    expect(DASHBOARD_MANIFEST.banners.disclaimer).toContain('合成镜像');
  });

  it('keeps ledger dual-books without a sent answer body', () => {
    const serialized = JSON.stringify(DASHBOARD_MANIFEST.ledger);
    expect(serialized).not.toMatch(/answerText|已发送|sentBody|finalAnswer/i);
    for (const row of DASHBOARD_MANIFEST.ledger.rows) {
      expect(row.rootQuestionId.startsWith('rq-')).toBe(true);
      expect(row.operationId.startsWith('op-')).toBe(true);
      expect(row.top3.length === 0 || row.top3.length === 3 || row.top3.length === 1).toBe(true);
    }
  });

  it('removed offline review, architecture, and VOC/workorder modules', () => {
    expect(DASHBOARD_MODULE_IDS).not.toContain('review');
    expect(DASHBOARD_MODULE_IDS).not.toContain('architecture');
    expect(DASHBOARD_MODULE_IDS).not.toContain('workorders');
  });

  it('blocks a four-domain release when product is missing', () => {
    const blocked = DASHBOARD_MANIFEST.content.releases.find((item) => item.blocked);
    expect(blocked?.bindings.find((item) => item.domain === 'product')?.bound).toBe(false);
    expect(blocked?.blockReason).toContain('缺域即阻断');
  });

  it('keeps coach upload as staged drafts without implying Feishu, Wiki, or published content', () => {
    const upload = DASHBOARD_MANIFEST.content.upload;
    expect(upload.draftOnlyCopy).toBe('上传只进入待审核草稿，不是已发布。');
    expect(upload.roleNote).toContain('coach');
    expect(upload.roleNote).toContain('管理员（owner）');
    expect(upload.roleNote).toContain('agent');
    expect(upload.roleNote).toContain('没有第四角色');
    expect(upload.roleNote).toContain('产品与活动');
    expect(upload.boundaryCopy).toContain('不连接飞书或 Wiki');
    expect(upload.aftersaleNote).toContain('售后流程仍为合成样例');
    expect(upload.aftersaleNote).toContain('不展开 SOP 树');
    expect(upload.accept).toContain('.csv');
    expect(upload.accept).toContain('.xlsx');
    expect(upload.demoCsv).toMatch(/^scene,script\n/u);
    expect(upload.demoCsv).toContain('售后质量升级');
    expect(DASHBOARD_MANIFEST.content.publishDisabledReason).toBe('请先登录后再发布');
    expect(JSON.stringify(upload)).not.toMatch(/已连接飞书|Wiki 已接入|已写入已发布/);
  });

  it('keeps the four formal domains, source readiness, and synthetic wording separate', () => {
    expect(DASHBOARD_MANIFEST.wording.domains.map((item) => item.id)).toEqual([
      'product',
      'campaign',
      'presale',
      'aftersale',
    ]);
    expect(
      DASHBOARD_MANIFEST.wording.domains
        .filter((item) => item.readiness === 'upstream_authoring')
        .map((item) => item.id),
    ).toEqual(['presale', 'aftersale']);
    const aftersale = DASHBOARD_MANIFEST.wording.domains.find((item) => item.id === 'aftersale');
    expect(aftersale?.readinessLabel).toBe('合成过敏树样例 · DEMO');
    expect(aftersale?.sourceSummary).toContain('不提供树编辑');
    expect(aftersale?.sourceSummary).toContain('内容与发布');
    expect(aftersale?.sourceSummary).not.toMatch(/不提供树编辑或上传/u);
    expect(DASHBOARD_MANIFEST.wording.entries.every((entry) => entry.dataClass === 'synthetic')).toBe(true);
    expect(JSON.stringify(DASHBOARD_MANIFEST.wording)).not.toMatch(/customerText|order_id|image_url/i);
  });

  it('models every manager decision as evidence, impact, accountability, timing, and navigation target', () => {
    for (const decision of DASHBOARD_MANIFEST.overview.decisions) {
      expect(decision.evidence.length).toBeGreaterThan(0);
      expect(decision.impact.length).toBeGreaterThan(0);
      expect(decision.owner.length).toBeGreaterThan(0);
      expect(decision.nextStep.length).toBeGreaterThan(0);
      expect(decision.statusLabel.length).toBeGreaterThan(0);
      expect(decision.reviewWindow.length).toBeGreaterThan(0);
      expect(DASHBOARD_MODULE_IDS).toContain(decision.target);
    }
    expect(DASHBOARD_MANIFEST.overview.decisions.map((item) => item.priority)).toEqual([
      'P0',
      'P1',
    ]);
  });

  it('keeps overview charts internally consistent and explicitly non-production', () => {
    const overview = DASHBOARD_MANIFEST.overview;
    expect(overview.trend).toHaveLength(8);
    expect(overview.operationStructure.reduce((sum, item) => sum + item.count, 0)).toBe(346);
    expect(overview.trend.at(-1)).toMatchObject({ questions: 128, noHitRate: 8.4, copyRate: 61.3 });
    expect(new Set(overview.health.map((item) => item.id)).size).toBe(overview.health.length);
    expect(overview.health.every((item) => item.period && item.definition && item.note)).toBe(true);
    expect(overview.health.every((item) => DASHBOARD_MODULE_IDS.includes(item.target))).toBe(true);
    expect(overview.health.find((item) => item.id === 'no-hit-rate')).toMatchObject({
      value: '8.4%',
      note: '29 / 346 次合成操作',
    });
    expect(overview.operationStructure.find((item) => item.id === 'copied')?.explanation).toContain(
      '不能推断最终发送',
    );
  });

  it('keeps offline review removed and announce simulation explicitly non-operational', () => {
    expect(DASHBOARD_MODULE_IDS).not.toContain('workorder-trash');
    expect(DASHBOARD_MODULE_IDS).not.toContain('review');
    expect(DASHBOARD_MODULE_IDS).not.toContain('architecture');
    expect(DASHBOARD_MODULE_IDS).not.toContain('ledger');
    expect(DASHBOARD_MODULE_IDS).not.toContain('iteration');
    expect(nextDashboardNavId('overview', 1)).toBe('wording');
    expect(nextDashboardNavId('announce', 1)).toBe('overview');
    expect(nextDashboardNavId('overview', -1)).toBe('announce');
    expect(DASHBOARD_MANIFEST.announce.simulation.disclaimer).toContain('不联网');
    expect(DASHBOARD_MANIFEST.announce.simulation.disclaimer).toContain('不发送');
    expect(DASHBOARD_MANIFEST.announce.simulation.disclaimer).toContain('不保存');
    expect(DASHBOARD_MANIFEST.announce.simulation.successMessage).toContain('未发送');
    expect(DASHBOARD_MANIFEST.announce.simulation.errorMessage).toContain('安全停止');
  });

  it('forbids real-brand names in compile-time runtime synthetic copy', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(JSON.stringify(DASHBOARD_MANIFEST)).not.toContain('达肤妍');
    expect(source).not.toContain('达肤妍');
    expect(DASHBOARD_MANIFEST.wording.disclaimer).toContain('虚构合成');
    expect(DASHBOARD_MANIFEST.wording.disclaimer).toContain('不是真实品牌或正式话术源');
  });

  it('keeps optimization tasks actionable without enabling automatic mutation', () => {
    for (const task of DASHBOARD_MANIFEST.iteration.tasks) {
      expect(['content_gap', 'ranking', 'stale', 'mixed']).toContain(task.cause);
      expect(['no_hit', 'top1_skipped']).toContain(task.kind);
      expect(task.owner.length).toBeGreaterThan(0);
      expect(task.evidenceCount).toBeGreaterThan(0);
      expect(task.nextStep.length).toBeGreaterThan(0);
    }
    expect(DASHBOARD_MANIFEST.iteration.domainNote).toContain('不自动改写');
  });

  it('keeps the iteration DTO aligned with the frozen IterationTask schema', () => {
    const ids = new Set<string>();
    for (const task of DASHBOARD_MANIFEST.iteration.tasks) {
      expect(task.taskId).toMatch(/^it-/);
      expect(task.signalId.length).toBeGreaterThan(0);
      expect(task.clusterKey.length).toBeGreaterThan(0);
      expect(task.version).toBeGreaterThanOrEqual(1);
      if (task.status === 'open') expect(task.version).toBe(1);
      if (task.status === 'in_progress') expect(task.version).toBe(2);
      if (task.status === 'resolved' || task.status === 'wont_fix') {
        expect(task.version).toBe(3);
        expect(task.resolution).toBe(task.status);
        expect(task.resolutionNote && task.resolutionNote.length).toBeGreaterThan(0);
      } else {
        expect(task.resolution).toBeNull();
        expect(task.resolutionNote).toBeNull();
      }
      expect(task.suggestedScriptIds.every((id) => id.startsWith('syn-'))).toBe(true);
      expect(task.sampleQueryIds.every((id) => id.startsWith('q-syn-'))).toBe(true);
      ids.add(task.taskId);
    }
    expect(ids.size).toBe(DASHBOARD_MANIFEST.iteration.tasks.length);
    // 风险升级属于 escalate 域；本模块只保留 no_hit / top1_skipped。
    expect(JSON.stringify(DASHBOARD_MANIFEST.iteration)).not.toContain('risk_escalated');
    expect(JSON.stringify(DASHBOARD_MANIFEST.iteration)).not.toContain('policy');
    expect(DASHBOARD_MANIFEST.iteration.footnote).toContain('不是正式 SLA');
  });

  it('lists only open P0 iteration tasks for the coach reminder', () => {
    const openP0 = listOpenP0IterationTasks(DASHBOARD_MANIFEST.iteration.tasks);
    expect(openP0.map((task) => task.taskId)).toEqual(['it-2041', 'it-2055']);
    expect(openP0.every((task) => task.status === 'open' && task.priority === 'P0')).toBe(true);
    expect(listOpenP0IterationTasks([])).toEqual([]);
    expect(
      listOpenP0IterationTasks([
        { ...DASHBOARD_MANIFEST.iteration.tasks[0], status: 'in_progress' },
        { ...DASHBOARD_MANIFEST.iteration.tasks[2], priority: 'P1' },
      ]),
    ).toEqual([]);
  });
});
