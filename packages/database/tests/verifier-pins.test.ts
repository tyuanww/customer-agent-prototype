import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The verifier pins one digest per migration count. A digest copied from one row into another
 * still compiles, and the suites that run at a single count never compare the others, so the
 * mistake survives every test until someone installs that exact historical count.
 *
 * This reads the table as text because the pins are private to the module. Entries that use a
 * named constant are skipped: the constants are opaque here, and the failure this guards
 * against is a literal pasted across rows.
 */
const source = readFileSync(new URL('../src/verifier.ts', import.meta.url), 'utf8');

function section(start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `${end} must follow ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

type Pin = Readonly<{ length: number; functions: number; sha: string }>;

function functionPins(): readonly Pin[] {
  const table = section('const READINESS_INVENTORY_BY_LENGTH', 'const READINESS_ACL_BY_LENGTH');
  const pins: Pin[] = [];
  for (const line of table.split('\n')) {
    const head = /^\s+(\d+): \{/.exec(line);
    const entries = /functionEntries: (\d+)/.exec(line);
    const sha = /functionSha256: '([0-9a-f]{64})'/.exec(line);
    if (!head || !entries || !sha) continue;
    pins.push({ length: Number(head[1]), functions: Number(entries[1]), sha: sha[1] ?? '' });
  }
  return pins;
}

describe('verifier digests', () => {
  it('does not give two different function counts the same literal digest', () => {
    const pins = functionPins();
    expect(pins.length, 'the table must expose literal pins to check').toBeGreaterThan(1);
    const bySha = new Map<string, Pin[]>();
    for (const pin of pins) {
      bySha.set(pin.sha, [...(bySha.get(pin.sha) ?? []), pin]);
    }
    for (const [sha, sharing] of bySha) {
      const counts = new Set(sharing.map(pin => pin.functions));
      expect(counts.size, `digest ${sha.slice(0, 8)} is shared by different function counts: `
        + sharing.map(pin => `${pin.length}:${pin.functions}`).join(', ')).toBe(1);
    }
  });

  it('keeps a distinct digest per count even when two counts hold the same functions', () => {
    // Counts 50, 51 and 52 all hold 277 functions but pin different digests, because the
    // function bodies differ between those overlays. Equal function counts therefore do not
    // imply equal digests, and the first case is the only relation that must hold.
    const pins = functionPins().filter(pin => pin.functions === 277);
    expect(new Set(pins.map(pin => pin.sha)).size, 'counts with the same function total but '
      + 'different bodies must not collapse to one digest').toBe(pins.length);
  });
});
