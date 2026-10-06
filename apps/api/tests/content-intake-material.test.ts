import { describe, expect, it } from 'vitest';
import { createTemplate, parseWorkbook, type ParseResult } from '@customer-agent/content-intake';
import { parseContractSchema } from '@customer-agent/contracts';
import { canonical, digest, materialFromParse } from '../src/content-intake/material.js';
import type { Source } from '../src/content-intake/authority.js';
import { qualityPopulation } from '../src/content-intake/quality.js';

const now = Date.parse('2026-10-06T00:00:00Z');
const source: Source = { scopeId: 'scope', scope: { tenantId: 't', appId: 'a', brandId: 'b', shopId: 'shop', domain: 'product', sourceId: 'source' },
  version: 1, templateVersion: 'faq-p1.1', ruleVersion: 'intake-p1.1', mappingVersion: 'm1', mode: 'v2-preview' };
const context = { sourceId: 'source', brandId: 'b', scope: 'shop', domain: 'product' as const, sheet: 'FAQ' as const, templateVersion: 'faq-p1.1' as const };
const row = (id = 'entry-a', body = '合成回答', state = '启用') => [id, '合成标题', body, '', '', '分类', '', state, '', '', '', '内部说明', '', '', 'false'];
async function input(rows = [row()]) {
  const bytes = await createTemplate(context, rows);
  return { parsed: await parseWorkbook(bytes, context), source, object: {
    objectId: 'object', sha256: digest(bytes), bytes: bytes.length, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const, sourceId: 'source',
  }, contributors: ['principal'], previous: [], terms: [], baseReleaseId: null, now, recentDisables: 0 };
}

describe('formal candidate material from independently parsed workbook', () => {
  it('binds every material field to the sampling tuple without pretending it is a governance hash', async () => {
    const material = materialFromParse(await input());
    const preview = (m = material) => qualityPopulation({ candidateId: 'candidate', version: 1, digest: digest(canonical(m)) }, m);
    const original = preview();
    expect(original.entries[0]?.entry.answerText).toBe('合成回答');
    for (const field of ['internalNote', 'riskNote', 'applicabilityNote'] as const) {
      const m = structuredClone(material); m.entries[0]![field] = '不同的合成说明';
      expect(preview(m).population[0]?.content_hash).not.toBe(original.population[0]?.content_hash);
    }
    const m = structuredClone(material);
    m.entries[0]!.questions = [{ id: 'question-a', version: 2, text: '不同的问法', active: false }];
    expect(preview(m).population[0]?.content_hash).not.toBe(original.population[0]?.content_hash);
    expect(() => qualityPopulation(original.key, m)).toThrow('MATERIAL_CHANGED');
    m.entries[0]!.attachmentNote = 'P2 未支持的附件说明';
    expect(() => preview(m)).toThrow('Contract validation failed');
  });

  it('namespaces IDs by source, keeps missing entries and binds explicit disables outside the old population', async () => {
    const material = materialFromParse(await input([row(), row('entry-b')]));
    const preview = (m = material) => qualityPopulation({ candidateId: 'candidate', version: 1, digest: digest(canonical(m)) }, m);
    const original = preview();
    const other = structuredClone(material); other.scope.sourceId = 'other-source'; other.object.sourceId = 'other-source';
    expect(preview(other).population[0]?.script_id).not.toBe(original.population[0]?.script_id);
    const disabled = materialFromParse({ ...await input([row('entry-a','合成回答','停用')]), previous: material.entries });
    const projection = preview(disabled);
    expect(projection.withdrawals).toEqual(['entry-a']);
    expect(projection.entries.map(x => x.entry.businessEntryId)).toEqual(['entry-b']);
    expect(projection.population[0]?.script_id).toBe(original.population[1]?.script_id);
    expect(projection.population[0]?.content_hash).not.toBe(original.population[1]?.content_hash);
    const duplicate = structuredClone(material); duplicate.entries.push(duplicate.entries[0]!);
    expect(() => preview(duplicate)).toThrow('MATERIAL_CHANGED');
  });

  it('uses the existing 500/501 sampling boundary and makes a critical candidate entirely mandatory', async () => {
    const material = materialFromParse(await input());
    const preview = (count: number, critical = false) => {
      const m = structuredClone(material);
      m.entries = Array.from({ length: count }, (_, n) => ({ ...material.entries[0]!, businessEntryId: `entry-${n}` }));
      m.risk.level = critical ? 'critical' : 'routine';
      return qualityPopulation({ candidateId: 'candidate', version: 1, digest: digest(canonical(m)) }, m);
    };
    expect(preview(500)).toMatchObject({ ordinaryCount: 500, mandatoryCount: 0, initialTarget: 500, expandedTarget: 500 });
    expect(preview(501)).toMatchObject({ ordinaryCount: 501, mandatoryCount: 0, initialTarget: 100, expandedTarget: 151 });
    expect(preview(501, true)).toMatchObject({ ordinaryCount: 0, mandatoryCount: 501, initialTarget: 0, expandedTarget: 0 });
  });
  it('preserves omitted entries and questions, with separate answer/question version allocation', async () => {
    const original = await input([row(), row('entry-b')]);
    const parsed: ParseResult = { ...original.parsed, questions: [{ entryId: 'entry-a', id: 'question-a', text: '合成问法', state: '启用' }] };
    const first = materialFromParse({ ...original, parsed });
    const next = await input([row()]);
    const same = materialFromParse({ ...next, previous: first.entries, now: now + 1000 });
    expect(same.entries).toEqual(first.entries);
    expect(same.differences).toEqual([]);
    const changed = materialFromParse({ ...next, previous: first.entries, parsed: { ...next.parsed,
      questions: [{ entryId: 'entry-a', id: 'question-a', text: '新合成问法', state: '启用' }] } });
    expect(changed.entries[0]).toMatchObject({ scriptVersion: 1, questions: [{ version: 2, text: '新合成问法' }] });
    expect(changed.entries[1]).toEqual(first.entries[1]);
    const body = materialFromParse({ ...await input([row('entry-a','新正文')]), previous: changed.entries });
    expect(body.entries[0]).toMatchObject({ scriptVersion: 2, questions: [{ version: 2 }] });
  });

  it('computes critical risk from before/after plus the same-source rolling count', async () => {
    const first = materialFromParse(await input([row(), row('entry-b')]));
    const changed = materialFromParse({ ...await input([row('entry-a','合成回答','停用')]), previous: first.entries, recentDisables: 1 });
    expect(changed.risk).toMatchObject({ level: 'critical', explicitDisableCount: 1, sameSourceDisabledLast24Hours: 1 });
    const allergy = materialFromParse(await input([row('entry-a','过敏请停手并确认情况')]));
    const removed = materialFromParse({ ...await input(), previous: allergy.entries });
    expect(removed.risk.level).toBe('critical');
  });

  it('treats an explicit risk note as an escalation and cannot downgrade by clearing it', async () => {
    const noted = row(); noted[12] = '赔付承诺需另一人复核';
    const first = materialFromParse(await input([noted]));
    expect(first.risk.level).toBe('critical');
    const removed = materialFromParse({ ...await input(), previous: first.entries });
    expect(removed.risk.level).toBe('critical');
  });

  it('rejects unknown vocabulary, cross-entry question identity and unsupported override materials', async () => {
    const vocabularyRow = row(); vocabularyRow[3] = 'missing-product';
    const vocabulary = await input([vocabularyRow]);
    expect(() => materialFromParse(vocabulary)).toThrow('SOURCE_MISMATCH');
    const first = materialFromParse({ ...await input(), parsed: { ...(await input()).parsed,
      questions: [{ entryId: 'entry-a', id: 'q1', text: '合成问法', state: '启用' }] } });
    const next = await input([row('entry-b')]);
    expect(() => materialFromParse({ ...next, previous: first.entries, parsed: { ...next.parsed,
      questions: [{ entryId: 'entry-b', id: 'q1', text: '合成问法', state: '启用' }] } })).toThrow('MATERIAL_CHANGED');
    const override = row(); override[10] = 'brand-source/entry';
    const overrideInput = await input([override]);
    expect(() => materialFromParse(overrideInput)).toThrow('SOURCE_MISMATCH');
  });

  it('produces canonical bytes accepted by the formal schema and rejects invalid Unicode', async () => {
    const m = materialFromParse(await input());
    expect(parseContractSchema('IntakeMaterial', JSON.parse(canonical(m)))).toEqual(m);
    expect(canonical({ z: '中', a: [true, null, 1] })).toBe('{"a":[true,null,1],"z":"中"}');
    expect(() => canonical({ text: '\ud800' })).toThrow('FILE_INVALID');
    expect(() => canonical({ text: '\u0000' })).toThrow('FILE_INVALID');
    expect(canonical({ text: '😀' })).toBe('{"text":"😀"}');
  });
});
