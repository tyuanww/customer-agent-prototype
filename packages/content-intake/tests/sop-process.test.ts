import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createParseRunner } from '@customer-agent/content-intake/runner';
import { createSyntheticSopWorkbook, tryParseSopAsFaq } from '../src/sop.js';
import { decodeSopOutcome, encodeSopOutcome } from '../src/sop-process.js';

const scope = { sourceId: 'source-synthetic', brandId: 'brand-synthetic', shopId: 'shop-synthetic' };
const decoder = new URL('./fixtures/sop-decoder-ok.mjs', import.meta.url);

describe('SOP parser process', () => {
  it('runs SOP in the bounded child and retains image bytes and row bindings', async () => {
    const workbook = await createSyntheticSopWorkbook();
    const outcome = await createParseRunner({ sopDecoderUrl: decoder }).parseSop(workbook.bytes, scope);
    expect(outcome.kind).toBe('parsed');
    if (outcome.kind !== 'parsed') throw new Error('SOP_RESULT_MISSING');
    expect(outcome.value.parsed.ok).toBe(true);
    expect(outcome.value.previews).toHaveLength(1);
    expect(outcome.value.previews[0]?.bytes.equals(workbook.png)).toBe(true);
    expect(outcome.value.rowBindings.map(row => row.businessEntryId)).toEqual(outcome.value.parsed.rows.map(row => row.id));
  });

  it('kills a timed-out child and can run the next SOP', async () => {
    const workbook = await createSyntheticSopWorkbook(), runner = createParseRunner({ sopDecoderUrl: decoder });
    expect(await runner.parseSop(workbook.bytes, scope, { timeoutMs: 1 })).toMatchObject({ kind: 'failure', result: { issues: [{ code: 'TIMEOUT' }] } });
    expect((await runner.parseSop(workbook.bytes, scope)).kind).toBe('parsed');
  });

  it('serializes SOP calls, waits for a cancelled child and releases its slot', async () => {
    const workbook = await createSyntheticSopWorkbook(), runner = createParseRunner({ sopDecoderUrl: decoder }), abort = new AbortController();
    const pending = runner.parseSop(workbook.bytes, scope, { signal: abort.signal });
    expect(await runner.parseSop(workbook.bytes, scope)).toMatchObject({ kind: 'failure', result: { issues: [{ code: 'BUSY' }] } });
    abort.abort();
    expect(await pending).toMatchObject({ kind: 'failure', result: { issues: [{ code: 'CANCELLED' }] } });
    expect((await runner.parseSop(workbook.bytes, scope)).kind).toBe('parsed');
  });

  it('cancels a child that has already entered a blocking decoder, then releases the shared slot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sop-decoder-test-'));
    const marker = join(directory, 'started');
    const blocked = new URL('./fixtures/sop-decoder-hang.mjs', import.meta.url);
    blocked.searchParams.set('marker', marker);
    const runner = createParseRunner({ sopDecoderUrl: blocked }), abort = new AbortController();
    try {
      const workbook = await createSyntheticSopWorkbook();
      const pending = runner.parseSop(workbook.bytes, scope, { signal: abort.signal, timeoutMs: 5_000 });
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 3_000, interval: 20 });
      const context = { sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId,
        scopeKind: 'shop' as const, domain: 'product' as const, sheet: 'FAQ' as const, templateVersion: 'faq-p1.1' as const };
      expect((await runner.parse(workbook.bytes, context)).result.issues[0]?.code).toBe('BUSY');
      abort.abort();
      expect(await pending).toMatchObject({ kind: 'failure', result: { issues: [{ code: 'CANCELLED' }] } });
      expect((await runner.parse(workbook.bytes, context)).result.issues[0]?.code).not.toBe('BUSY');
    } finally { abort.abort(); await rm(directory, { recursive: true, force: true }); }
  });

  it('does not accept an unconfigured or non-file decoder', async () => {
    const workbook = await createSyntheticSopWorkbook();
    expect(await createParseRunner().parseSop(workbook.bytes, scope)).toMatchObject({ kind: 'failure', result: { issues: [{ code: 'INVALID_CONTEXT' }] } });
    expect(await createParseRunner({ sopDecoderUrl: new URL('https://synthetic.example/decoder') }).parseSop(workbook.bytes, scope))
      .toMatchObject({ kind: 'failure', result: { issues: [{ code: 'INVALID_CONTEXT' }] } });
  });

  it('reuses one asset for repeated placements and rejects modified child output', async () => {
    const workbook = await createSyntheticSopWorkbook({ sameImageOnLastTextRow: true });
    const parsed = await tryParseSopAsFaq(workbook.bytes, scope);
    if (!parsed) throw new Error('SOP_FIXTURE_INVALID');
    const wire = encodeSopOutcome(parsed);
    expect(decodeSopOutcome(wire)).toEqual({ kind: 'parsed', value: parsed });
    const data = structuredClone(wire) as { value: { assets: { sha256: string }[]; previews: { rowId: string }[] } };
    expect(data.value.assets).toHaveLength(1); expect(data.value.previews).toHaveLength(2);
    data.value.assets[0]!.sha256 = '0'.repeat(64);
    expect(decodeSopOutcome(data)).toBeNull();
    const badRow = structuredClone(wire) as { value: { previews: { rowId: string }[] } };
    badRow.value.previews[0]!.rowId = 'unrelated';
    expect(decodeSopOutcome(badRow)).toBeNull();
    const wrongSheet = structuredClone(wire) as { value: { rowBindings: { rowId: string }[] } };
    wrongSheet.value.rowBindings[0]!.rowId = 'sop:长痘痘SOP:20';
    expect(decodeSopOutcome(wrongSheet)).toBeNull();
    const gif = structuredClone(wire) as { value: { assets: { mime: string }[]; previews: { mime: string }[] } };
    gif.value.assets.forEach(asset => { asset.mime = 'image/gif'; });
    gif.value.previews.forEach(preview => { preview.mime = 'image/gif'; });
    expect(decodeSopOutcome(gif)).toBeNull();
  });

  it('preserves a SOP answer assembled from multiple valid long cells', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array((await createSyntheticSopWorkbook()).bytes).buffer);
    const sheet = workbook.getWorksheet('过敏流程SOP');
    if (!sheet) throw new Error('SOP_FIXTURE_INVALID');
    sheet.getCell('D2').value = 'A'.repeat(20_000); sheet.getCell('E2').value = 'B'.repeat(20_000);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const outcome = await createParseRunner({ sopDecoderUrl: decoder }).parseSop(bytes, scope);
    expect(outcome.kind).toBe('parsed');
    if (outcome.kind !== 'parsed') throw new Error('SOP_RESULT_MISSING');
    expect(outcome.value.parsed.rows[0]!.body.length).toBeGreaterThan(40_000);
  });
});
