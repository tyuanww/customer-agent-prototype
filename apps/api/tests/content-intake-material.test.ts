import { describe, expect, it } from 'vitest';
import { createTemplate, parseWorkbook, createCsvTemplate, parseCsv, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_STRUCTURE_SHA256, type ParseResult } from '@customer-agent/content-intake';
import { parseContractSchema } from '@customer-agent/contracts';
import { canonical, digest, materialFromParse } from '../src/content-intake/material.js';
import type { Source } from '../src/content-intake/authority.js';
import { qualityPopulation } from '../src/content-intake/quality.js';

const now = Date.parse('2026-10-06T00:00:00Z');
const source: Source = { scopeId: 'scope', scope: { tenantId: 't', appId: 'a', brandId: 'b', shopId: 'shop', domain: 'product', sourceId: 'source' },
  version: 1, templateVersion: 'faq-p1.1', ruleVersion: 'intake-p1.1', mappingVersion: 'm1', structureDigest: 'a'.repeat(64), mode: 'v2-preview' };
const context = { sourceId: 'source', brandId: 'b', scope: 'shop', scopeKind: 'shop' as const, domain: 'product' as const, sheet: 'FAQ' as const, templateVersion: 'faq-p1.1' as const };
const row = (id = 'entry-a', body = '合成回答', state = '启用') => [id, '合成标题', body, '', '', '分类', '', state, '', '', '', '内部说明', '', '', 'false'];
async function input(rows = [row()]) {
  const bytes = await createTemplate(context, rows);
  return { parsed: await parseWorkbook(bytes, context), source, object: {
    objectId: 'object', sha256: digest(bytes), bytes: bytes.length, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const, sourceId: 'source',
  }, contributors: ['principal'], previous: [], terms: [], baseReleaseId: null, now, recentDisables: 0 };
}

describe('formal candidate material from independently parsed workbook', () => {
  it('binds CSV format, original-byte object and independent questions without changing FAQ material rules', () => {
    const csvContext = { ...context, templateVersion: CSV_TEMPLATE_VERSION } as const;
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), createCsvTemplate(csvContext, [
      { faq: row(), question: ['question-1', '合成问法一', '启用'] }, { faq: row(), question: ['question-2', '合成问法二', '停用'] },
    ])]);
    const registered = { ...source, templateVersion: CSV_TEMPLATE_VERSION, ruleVersion: CSV_POLICY_VERSION,
      mappingVersion: CSV_MAPPING_VERSION, structureDigest: CSV_STRUCTURE_SHA256 };
    const parsed = parseCsv(bytes, csvContext);
    const object = { objectId: 'csv-object', sourceId: 'source', sha256: digest(bytes), bytes: bytes.length, mime: 'text/csv' as const };
    const input = { parsed, source: registered, object, contributors: ['principal'], previous: [], terms: [], baseReleaseId: null, now, recentDisables: 0 };
    const material = materialFromParse(input);
    expect(material).toMatchObject({ selectedSheets: ['CSV'], templateVersion: CSV_TEMPLATE_VERSION, ruleVersion: CSV_POLICY_VERSION,
      mappingVersion: CSV_MAPPING_VERSION, sourceClaim: { fileSha256: digest(bytes) }, object });
    expect(material.entries).toHaveLength(1);
    expect(material.entries[0]!.questions).toEqual([
      { id: 'question-1', version: 1, text: '合成问法一', active: true }, { id: 'question-2', version: 1, text: '合成问法二', active: false },
    ]);
    expect(() => materialFromParse({ ...input, parsed: { ...parsed, policyVersion: 'intake-p1.1' } })).toThrow('SOURCE_FORMAT_MISMATCH');
    expect(() => materialFromParse({ ...input, object: { ...object, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } })).toThrow('SOURCE_FORMAT_MISMATCH');
    expect(() => materialFromParse({ ...input, source: { ...registered, mappingVersion: 'other' } })).toThrow('SOURCE_FORMAT_MISMATCH');
    expect(() => materialFromParse({ ...input, source: { ...registered, structureDigest: 'a'.repeat(64) } })).toThrow('SOURCE_FORMAT_MISMATCH');
  });
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
    expect(allergy.risk.level).not.toBe('critical');
    const removed = materialFromParse({ ...await input(), previous: allergy.entries });
    expect(removed.risk.level).not.toBe('critical');
  });

  it('treats an explicit risk note as an escalation and cannot downgrade by clearing it', async () => {
    const noted = row(); noted[12] = '赔付承诺需另一人复核';
    const first = materialFromParse(await input([noted]));
    expect(first.risk.level).toBe('critical');
    const removed = materialFromParse({ ...await input(), previous: first.entries });
    expect(removed.risk.level).toBe('critical');
  });

  it('rejects unknown vocabulary and cross-entry question identity', async () => {
    const vocabularyRow = row(); vocabularyRow[3] = 'missing-product';
    const vocabulary = await input([vocabularyRow]);
    expect(() => materialFromParse(vocabulary)).toThrow('SOURCE_MISMATCH');
    const first = materialFromParse({ ...await input(), parsed: { ...(await input()).parsed,
      questions: [{ entryId: 'entry-a', id: 'q1', text: '合成问法', state: '启用' }] } });
    const next = await input([row('entry-b')]);
    expect(() => materialFromParse({ ...next, previous: first.entries, parsed: { ...next.parsed,
      questions: [{ entryId: 'entry-b', id: 'q1', text: '合成问法', state: '启用' }] } })).toThrow('MATERIAL_CHANGED');
  });

  it('binds a family as a pair, versions association changes and clears only explicitly uploaded associations', async () => {
    const first = materialFromParse(await input([row(), row('entry-b')]));
    const associatedRow = row(); associatedRow[10] = 'brand-source/root-a';
    const associated = materialFromParse({ ...await input([associatedRow]), previous: first.entries });
    expect(associated.entries[0]).toMatchObject({ familySourceId: 'brand-source', familyBusinessEntryId: 'root-a', scriptVersion: 2 });
    expect(associated.differences[0]).toMatchObject({ change: 'modify', previousVersion: 1, nextVersion: 2 });
    expect(associated.differences[0]!.beforeDigest).not.toBe(associated.differences[0]!.afterDigest);
    const same = materialFromParse({ ...await input([associatedRow]), previous: associated.entries });
    expect(same.entries).toEqual(associated.entries); expect(same.differences).toEqual([]);
    const missing = materialFromParse({ ...await input([row('entry-b')]), previous: associated.entries });
    expect(missing.entries).toEqual(associated.entries); expect(missing.differences).toEqual([]);
    associatedRow[10] = 'other-brand-source/root-b';
    const changed = materialFromParse({ ...await input([associatedRow]), previous: associated.entries });
    expect(changed.entries[0]).toMatchObject({ familySourceId: 'other-brand-source', familyBusinessEntryId: 'root-b', scriptVersion: 3 });
    expect(digest(canonical(changed))).not.toBe(digest(canonical(associated)));
    const cleared = materialFromParse({ ...await input(), previous: changed.entries });
    expect(cleared.entries[0]).toMatchObject({ familySourceId: null, familyBusinessEntryId: null, scriptVersion: 4 });
    expect(cleared.differences[0]).toMatchObject({ change: 'modify', previousVersion: 3, nextVersion: 4 });
    expect(cleared.entries[1]).toEqual(first.entries[1]);
  });

  it.each(['root/', '/entry', 'root/entry/extra', 'EXAMPLE_root/entry', 'root/EXAMPLE_entry', 'source/entry']) (
    'rechecks malformed family %s even when a parsed DTO claims success', async (family) => {
      const prepared = await input();
      const forged = structuredClone(prepared.parsed); (forged.rows[0]!.values as string[])[10] = family;
      expect(() => materialFromParse({ ...prepared, parsed: forged })).toThrow('FILE_INVALID');
    });
  it('uses the registered source to reject brand and self-source associations', async () => {
    const associatedRow = row(); associatedRow[10] = 'brand-source/root';
    const prepared = await input([associatedRow]);
    expect(prepared.parsed.ok).toBe(true);
    expect(() => materialFromParse({ ...prepared, source: { ...source, scope: { ...source.scope, shopId: null } } })).toThrow('FILE_INVALID');
    expect(() => materialFromParse({ ...prepared, source: { ...source, scope: { ...source.scope, sourceId: 'brand-source' } } })).toThrow('FILE_INVALID');
  });
  it('allows a shop ID literally named brand without granting brand-only authority', async () => {
    const associatedRow = row(); associatedRow[10] = 'generic-source/root';
    const shopContext = { ...context, scope: 'brand' };
    const bytes = await createTemplate(shopContext, [associatedRow]);
    const parsed = await parseWorkbook(bytes, shopContext);
    expect(parsed.ok).toBe(true);
    const prepared = { ...await input(), parsed, source: { ...source, scope: { ...source.scope, shopId: 'brand' } } };
    expect(materialFromParse(prepared).entries[0]).toMatchObject({ familySourceId: 'generic-source', familyBusinessEntryId: 'root', brandNonOverridable: false });
    const forged = structuredClone(parsed); (forged.rows[0]!.values as string[])[14] = 'true';
    expect(() => materialFromParse({ ...prepared, parsed: forged })).toThrow('SCOPE_DENIED');
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
