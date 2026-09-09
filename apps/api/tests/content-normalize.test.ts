import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { parseImportFile, sampleScriptIds, utcTimestampText } from '../src/content-normalize.js';

const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将发出,srcv_t3_presale_v1,SRC-T3-PRESALE,什么时候发货,low,false',
  '',
].join('\n'));

function zipCsv(name: string, csv: Buffer): Buffer {
  const compressed = deflateRawSync(csv);
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(csv.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, compressed]);
}

describe('content import normalization', () => {
  const defaults = { intentTaxonomyVersion: 'itax_synthetic_t3_v1', intentId: 'intent_synthetic_t3_shipping' };

  it('parses CSV into DEC-042 staging rows without review self-assertion', () => {
    const rows = parseImportFile(CSV, 'csv', defaults);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.script_id).toBe('shipping-001');
    expect(rows[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toMatch(/review_mode|quality_gate_passed|primary_reviewer/);
    expect(sampleScriptIds(rows, 'ab'.repeat(32), 1)).toContain('shipping-001');
  });

  it('reads a bounded xlsx zip that carries a csv member', () => {
    const payload = zipCsv('xl/scripts.csv', CSV);
    const rows = parseImportFile(payload, 'excel', defaults);
    expect(rows[0]?.title).toBe('发货时效');
  });

  it('serializes timestamps with six UTC microsecond digits', () => {
    expect(utcTimestampText(new Date('2026-09-09T01:02:03.123Z'))).toBe('2026-09-09T01:02:03.123000Z');
  });

  it('rejects an xlsx zip member that is not stored or deflated', () => {
    const nameBytes = Buffer.from('xl/scripts.csv');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(9, 8);
    header.writeUInt32LE(4, 18);
    header.writeUInt32LE(4, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    expect(() => parseImportFile(Buffer.concat([header, nameBytes, Buffer.from('abcd')]), 'excel', defaults))
      .toThrow('UNSUPPORTED_FORMAT');
  });
});
