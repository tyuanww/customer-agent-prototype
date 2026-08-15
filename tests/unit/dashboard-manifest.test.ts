import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_MANIFEST,
  DASHBOARD_DEFERRED_NAV,
  DASHBOARD_MODULE_IDS,
  DASHBOARD_NAV,
} from '../../src/renderer/data/dashboard-manifest';

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/data/dashboard-manifest.ts',
);

describe('dashboard manifest', () => {
  it('is deeply frozen compile-time data with nine decision-oriented modules', () => {
    expect(DASHBOARD_MODULE_IDS).toHaveLength(9);
    expect(DASHBOARD_NAV.map((item) => item.id)).toEqual([...DASHBOARD_MODULE_IDS]);
    expect(Object.isFrozen(DASHBOARD_MANIFEST)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.ledger.rows)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.overview.metrics[0])).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.wording.entries)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.review.dimensions)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_MANIFEST.workorders.timeSlices)).toBe(true);
    expect(Object.isFrozen(DASHBOARD_DEFERRED_NAV)).toBe(true);
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

  it('keeps offline review as three separate evidence accounts without raw text', () => {
    const review = DASHBOARD_MANIFEST.review;
    expect(review.dimensions.map((dimension) => dimension.id)).toEqual([
      'modified',
      'sent',
      'applicable',
    ]);
    expect(review.inferenceBoundary).toContain('不能推断已发送');
    expect(review.inferenceBoundary).toContain('回答正确');
    for (const dimension of review.dimensions) {
      expect(dimension.reviewed).toBe(dimension.verifiable + dimension.unverifiable);
      expect(dimension.outcomes.reduce((total, outcome) => total + outcome.count, 0)).toBe(
        dimension.reviewed,
      );
      expect(dimension.outcomes.some((outcome) => outcome.id === 'unverifiable')).toBe(true);
    }
    expect(JSON.stringify(review)).not.toMatch(/answerText|customerText|order_id|image_url|sentBody/i);
  });

  it('marks search/events/content/workorders as redline and keeps LLM off', () => {
    const redline = DASHBOARD_MANIFEST.architecture.ports
      .filter((port) => port.redline)
      .map((port) => port.id);
    expect(redline).toEqual(['search', 'events', 'workorders', 'content']);
    expect(DASHBOARD_MANIFEST.architecture.llm.statusLabel).toContain('默认关闭');
    expect(DASHBOARD_MANIFEST.architecture.llm.detail).toContain('绝不改写');
  });

  it('blocks a four-domain release when product is missing', () => {
    const blocked = DASHBOARD_MANIFEST.content.releases.find((item) => item.blocked);
    expect(blocked?.bindings.find((item) => item.domain === 'product')?.bound).toBe(false);
    expect(blocked?.blockReason).toContain('缺域即阻断');
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

  it('keeps the VOC Pareto and product heatmap as aggregate-only synthetic structures', () => {
    const workorders = DASHBOARD_MANIFEST.workorders;
    expect(workorders.insights.reduce((sum, item) => sum + item.count, 0)).toBe(
      workorders.batch.ticketCount,
    );
    for (const item of workorders.insights) {
      expect(item.productBreakdown.reduce((sum, part) => sum + part.count, 0)).toBe(item.count);
      expect(item.owner.length).toBeGreaterThan(0);
      expect(item.nextStep.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(workorders.insights)).not.toMatch(
      /customerText|commentText|mobile|order_id|receiver_address|image_url/i,
    );
  });

  it('keeps every synthetic VOC time slice internally consistent and referentially valid', () => {
    const workorders = DASHBOARD_MANIFEST.workorders;
    const insightIds = new Set(workorders.insights.map((item) => item.id));
    const productIds = new Set(workorders.productFilters.slice(1));

    expect(new Set(workorders.timeSlices.map((slice) => slice.id)).size).toBe(
      workorders.timeSlices.length,
    );
    expect(new Set(workorders.timeSlices.map((slice) => slice.grain))).toEqual(
      new Set(['year', 'month', 'day']),
    );
    for (const slice of workorders.timeSlices) {
      expect(slice.uniqueOrders).toBeLessThanOrEqual(slice.ticketCount);
      expect(new Set(slice.issueCounts.map((item) => item.insightId)).size).toBe(
        slice.issueCounts.length,
      );
      expect(slice.issueCounts.every((item) => insightIds.has(item.insightId))).toBe(true);
      expect(
        slice.issueCounts.every((item) => item.productBreakdown.every((part) => productIds.has(part.product))),
      ).toBe(true);
      expect(
        slice.issueCounts.reduce(
          (sliceTotal, item) => sliceTotal + item.productBreakdown.reduce(
            (itemTotal, part) => itemTotal + part.count,
            0,
          ),
          0,
        ),
      ).toBe(slice.ticketCount);
    }
  });

  it('keeps deferred trash and announce simulation explicitly non-operational', () => {
    expect(DASHBOARD_DEFERRED_NAV).toEqual([
      expect.objectContaining({ id: 'workorder-trash', statusLabel: '二期待实施' }),
    ]);
    expect(DASHBOARD_MODULE_IDS).not.toContain('workorder-trash');
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
      expect(['content_gap', 'ranking', 'policy']).toContain(task.cause);
      expect(task.owner.length).toBeGreaterThan(0);
      expect(task.evidenceCount).toBeGreaterThan(0);
      expect(task.nextStep.length).toBeGreaterThan(0);
    }
    expect(DASHBOARD_MANIFEST.iteration.domainNote).toContain('不自动改写');
  });
});
