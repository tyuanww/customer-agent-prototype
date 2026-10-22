import { describe, expect, it } from 'vitest';
import { assertNoRowIdCollision, type RowBinding } from '../src/content-intake/sop-freeze.js';

const row = (code: string, sheetRow: number): RowBinding => ({
  rowId: `sop:过敏流程SOP:${sheetRow}`, businessEntryId: code, title: '过敏流程SOP', answerText: '合成答案',
});

/** A code names its row, so moving that row is legal. Two entries claiming one
 * physical row is not: `sop_candidate_rows` is keyed on (candidate, version, row_id),
 * so the insert would fail with a raw 23505 rather than a rejection. */
describe('inherited SOP rows may not claim a fresh row', () => {
  it('accepts an insertion above published entries, which moves their rows', () => {
    const fresh = [row('A-0', 2), row('A-1', 3), row('A-2', 4)];
    expect(() => assertNoRowIdCollision(fresh, [])).not.toThrow();
  });

  it('accepts an omitted entry that keeps its published row', () => {
    const fresh = [row('A-1', 2)];
    const inherited = [row('A-2', 3)];
    expect(() => assertNoRowIdCollision(fresh, inherited)).not.toThrow();
  });

  it('refuses a new code that reuses an omitted entry published row', () => {
    // Published: A-1 at row 2, A-2 at row 3. New workbook drops A-2 and puts B-1 in
    // its place, so the inherited A-2 and the fresh B-1 both claim row 3.
    const fresh = [row('A-1', 2), row('B-1', 3)];
    const inherited = [row('A-2', 3)];
    expect(() => assertNoRowIdCollision(fresh, inherited)).toThrowError(
      expect.objectContaining({ reason: 'MATERIAL_CHANGED' }));
  });
});
