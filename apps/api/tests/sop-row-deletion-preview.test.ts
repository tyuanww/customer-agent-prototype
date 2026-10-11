import { expect, it } from 'vitest';
import { stagePreviews, adoptPreviews, cancelPreviewsAtVersion, listPreviews, previewFromBytes, retainPreviewRowsAtVersion, discardPreviews } from '../src/content-intake/linked-preview.js';

const sources = new Set(['synthetic-sop']);
it('a later confirmed deletion projects all remaining rows after an earlier unknown commit', () => {
  const images = ['a', 'b', 'c'].map(row => previewFromBytes(Buffer.from(row), 'image/png', 'synthetic-sop', row));
  stagePreviews('unordered-input', images); adoptPreviews('unordered-input', 'unordered-candidate', 1);
  try {
    // v2 removed a but its response was lost. v3 removes b, carrying the complete
    // remaining-row set from the database, not just the most recent delta.
    retainPreviewRowsAtVersion('unordered-candidate', ['c'], 3);
    expect(listPreviews('unordered-candidate', sources).map(row => row.rowId)).toEqual(['c']);
    retainPreviewRowsAtVersion('unordered-candidate', ['b', 'c'], 2);
    expect(listPreviews('unordered-candidate', sources).map(row => row.rowId)).toEqual(['c']);
  } finally { discardPreviews('unordered-candidate'); }
});
it('a text-only reimport clears current candidate images without deleting an older release alias', () => {
  const image = previewFromBytes(Buffer.from('old'), 'image/png', 'synthetic-sop', 'a');
  stagePreviews('text-input', [image]); adoptPreviews('text-input', 'text-candidate', 1); adoptPreviews('text-candidate', 'old-release');
  try {
    adoptPreviews('empty-input', 'text-candidate', 2);
    expect(listPreviews('text-candidate', sources)).toEqual([]);
    retainPreviewRowsAtVersion('text-candidate', [], 1);
    expect(listPreviews('old-release', sources)).toEqual([image]);
  } finally { discardPreviews('old-release'); }
});

it('a deletion confirmed before the first parse projection keeps a late parse from restoring images', () => {
  const image = previewFromBytes(Buffer.from('late-first'), 'image/png', 'synthetic-sop', 'a');
  stagePreviews('late-first-input', [image]);
  try {
    retainPreviewRowsAtVersion('late-first-candidate', [], 2);
    adoptPreviews('late-first-input', 'late-first-candidate', 1);
    expect(listPreviews('late-first-candidate', sources)).toEqual([]);
  } finally { discardPreviews('late-first-candidate'); discardPreviews('late-first-input'); }
});

it('removing the final image retains a version barrier against the delayed parse result', () => {
  const image = previewFromBytes(Buffer.from('late-last'), 'image/png', 'synthetic-sop', 'a');
  stagePreviews('late-last-input', [image]); adoptPreviews('late-last-input', 'late-last-candidate', 1);
  // A concurrent parse has already staged its own array but not projected it.
  stagePreviews('late-last-input', [image]);
  try {
    retainPreviewRowsAtVersion('late-last-candidate', [], 1);
    adoptPreviews('late-last-input', 'late-last-candidate', 1);
    expect(listPreviews('late-last-candidate', sources)).toEqual([]);
    // A genuinely newer parse remains allowed after the empty projection.
    adoptPreviews('late-last-input', 'late-last-candidate', 2);
    expect(listPreviews('late-last-candidate', sources)).toEqual([image]);
  } finally { discardPreviews('late-last-candidate'); discardPreviews('late-last-input'); }
});

it('an older parse cannot replace the surviving images of a newer deletion revision', () => {
  const images = ['a', 'b'].map(row => previewFromBytes(Buffer.from(`late-${row}`), 'image/png', 'synthetic-sop', row));
  stagePreviews('late-partial-input', images); adoptPreviews('late-partial-input', 'late-partial-candidate', 1);
  stagePreviews('late-partial-input', images);
  try {
    retainPreviewRowsAtVersion('late-partial-candidate', ['b'], 3);
    adoptPreviews('late-partial-input', 'late-partial-candidate', 2);
    expect(listPreviews('late-partial-candidate', sources).map(row => row.rowId)).toEqual(['b']);
  } finally { discardPreviews('late-partial-candidate'); discardPreviews('late-partial-input'); }
});

it('deletion before candidate adoption projects surviving images from its exact staged input', () => {
  const images = ['a', 'b'].map(row => previewFromBytes(Buffer.from(`staged-${row}`), 'image/png', 'synthetic-sop', row));
  stagePreviews('staged-deletion-input', images);
  try {
    retainPreviewRowsAtVersion('staged-deletion-candidate', ['b'], 2, 'staged-deletion-input');
    adoptPreviews('staged-deletion-input', 'staged-deletion-candidate', 1);
    expect(listPreviews('staged-deletion-candidate', sources)).toEqual([images[1]]);
  } finally { discardPreviews('staged-deletion-candidate'); discardPreviews('staged-deletion-input'); }
});

it('same-version receipts may shrink but cannot expand a cancelled projection', () => {
  const images = ['a', 'b'].map(row => previewFromBytes(Buffer.from(`same-${row}`), 'image/png', 'synthetic-sop', row));
  stagePreviews('same-version-input', images); adoptPreviews('same-version-input', 'same-version-candidate', 1);
  try {
    retainPreviewRowsAtVersion('same-version-candidate', ['b'], 2, 'same-version-input');
    retainPreviewRowsAtVersion('same-version-candidate', [], 2, 'same-version-input');
    retainPreviewRowsAtVersion('same-version-candidate', ['b'], 2, 'same-version-input');
    expect(listPreviews('same-version-candidate', sources)).toEqual([]);
  } finally { discardPreviews('same-version-input'); discardPreviews('same-version-candidate'); }
});
it('rollback restores its prior input without touching committed aliases or a later stage', () => {
  const original = previewFromBytes(Buffer.from('restore-original'), 'image/png', 'synthetic-sop', 'a');
  const replacement = previewFromBytes(Buffer.from('restore-new'), 'image/png', 'synthetic-sop', 'b');
  stagePreviews('restore-input', [original]); adoptPreviews('restore-input', 'restore-release');
  try {
    const restore = stagePreviews('restore-input', [replacement]); restore.rollback();
    expect(listPreviews('restore-input', sources)).toEqual([original]);
    expect(listPreviews('restore-release', sources)).toEqual([original]);
    const staleRestore = stagePreviews('restore-input', [replacement]);
    stagePreviews('restore-input', [replacement, original]); staleRestore.rollback();
    expect(listPreviews('restore-input', sources)).toEqual([replacement, original]);
    expect(listPreviews('restore-release', sources)).toEqual([original]);
  } finally { discardPreviews('restore-input'); discardPreviews('restore-release'); }
});

it('restores the original input after nested stages roll back in predecessor-first order', () => {
  const original = previewFromBytes(Buffer.from('chain-original'), 'image/png', 'synthetic-sop', 'original');
  const a = previewFromBytes(Buffer.from('chain-a'), 'image/png', 'synthetic-sop', 'a');
  const b = previewFromBytes(Buffer.from('chain-b'), 'image/png', 'synthetic-sop', 'b');
  stagePreviews('chain-input', [original]); adoptPreviews('chain-input', 'chain-release');
  try {
    const rollbackA = stagePreviews('chain-input', [a]);
    const rollbackB = stagePreviews('chain-input', [b]);
    rollbackA.rollback(); rollbackB.rollback();
    expect(listPreviews('chain-input', sources)).toEqual([original]);
    expect(listPreviews('chain-release', sources)).toEqual([original]);
  } finally { discardPreviews('chain-input'); discardPreviews('chain-release'); }
});
it('retains a successful successor when an earlier stage rolls back', () => {
  const original = previewFromBytes(Buffer.from('success-original'), 'image/png', 'synthetic-sop', 'original');
  const next = previewFromBytes(Buffer.from('success-next'), 'image/png', 'synthetic-sop', 'next');
  stagePreviews('success-input', [original]); adoptPreviews('success-input', 'success-old-release');
  try {
    const rollbackA = stagePreviews('success-input', [original]);
    stagePreviews('success-input', [next]).commit('success-new-release');
    rollbackA.rollback();
    expect(listPreviews('success-input', sources)).toEqual([next]);
    expect(listPreviews('success-old-release', sources)).toEqual([original]);
    expect(listPreviews('success-new-release', sources)).toEqual([next]);
  } finally { discardPreviews('success-input'); discardPreviews('success-old-release'); discardPreviews('success-new-release'); }
});
it('keeps an unknown predecessor available when its successor rolls back', () => {
  const original = previewFromBytes(Buffer.from('unknown-original'), 'image/png', 'synthetic-sop', 'original');
  const unknown = previewFromBytes(Buffer.from('unknown-stage'), 'image/png', 'synthetic-sop', 'unknown');
  stagePreviews('unknown-input', [original]); adoptPreviews('unknown-input', 'unknown-old-release');
  try {
    const pending = stagePreviews('unknown-input', [unknown]); // No settlement on COMMIT_UNKNOWN.
    const rollbackLater = stagePreviews('unknown-input', [original]); rollbackLater.rollback();
    expect(listPreviews('unknown-input', sources)).toEqual([unknown]);
    pending.commit('unknown-recovered', 1);
    expect(listPreviews('unknown-recovered', sources)).toEqual([unknown]);
    expect(listPreviews('unknown-old-release', sources)).toEqual([original]);
  } finally { discardPreviews('unknown-input'); discardPreviews('unknown-old-release'); discardPreviews('unknown-recovered'); }
});

it.each([false, true])('an older exact stage commit cannot settle its pending successor: ignored=%s', ignored => {
  const original = previewFromBytes(Buffer.from('exact-original'), 'image/png', 'synthetic-sop', 'a');
  const later = previewFromBytes(Buffer.from('exact-later'), 'image/png', 'synthetic-sop', 'b');
  const first = stagePreviews('exact-input', [original]);
  const pending = stagePreviews('exact-input', [later]);
  try {
    if (ignored) retainPreviewRowsAtVersion('exact-candidate', [], 2, 'exact-input');
    first.commit('exact-candidate', 1);
    expect(listPreviews('exact-candidate', sources)).toEqual(ignored ? [] : [original]);
    pending.rollback();
    expect(listPreviews('exact-input', sources)).toEqual([original]);
    expect(listPreviews('exact-candidate', sources)).toEqual(ignored ? [] : [original]);
  } finally { discardPreviews('exact-input'); discardPreviews('exact-candidate'); }
});

it('a cancelled revision blocks late commits and clears only its own array aliases', () => {
  const original = previewFromBytes(Buffer.from('cancel-original'), 'image/png', 'synthetic-sop', 'a');
  const later = previewFromBytes(Buffer.from('cancel-later'), 'image/png', 'synthetic-sop', 'b');
  const first = stagePreviews('cancel-owned-input', [original]);
  first.commit('cancel-owned-candidate', 1);
  adoptPreviews('cancel-owned-candidate', 'cancel-owned-alias');
  const pending = stagePreviews('cancel-owned-input', [later]);
  try {
    cancelPreviewsAtVersion('cancel-owned-candidate', 1);
    expect(listPreviews('cancel-owned-candidate', sources)).toEqual([]);
    expect(listPreviews('cancel-owned-alias', sources)).toEqual([]);
    expect(listPreviews('cancel-owned-input', sources)).toEqual([later]);
    first.commit('cancel-owned-candidate', 1);
    expect(listPreviews('cancel-owned-candidate', sources)).toEqual([]);
    pending.commit('cancel-owned-candidate', 2);
    cancelPreviewsAtVersion('cancel-owned-candidate', 1);
    expect(listPreviews('cancel-owned-candidate', sources)).toEqual([later]);
    expect(listPreviews('cancel-owned-input', sources)).toEqual([later]);
  } finally { discardPreviews('cancel-owned-input'); discardPreviews('cancel-owned-candidate'); }
});
it('cancellation before any candidate alias leaves a barrier against the first late commit', () => {
  const image = previewFromBytes(Buffer.from('cancel-before-adopt'), 'image/png', 'synthetic-sop', 'a');
  const stage = stagePreviews('cancel-unadopted-input', [image]);
  try {
    cancelPreviewsAtVersion('cancel-unadopted-candidate', 1);
    stage.commit('cancel-unadopted-candidate', 1);
    expect(listPreviews('cancel-unadopted-candidate', sources)).toEqual([]);
    adoptPreviews('cancel-unadopted-input', 'cancel-unadopted-candidate', 1);
    expect(listPreviews('cancel-unadopted-candidate', sources)).toEqual([]);
  } finally { discardPreviews('cancel-unadopted-input'); discardPreviews('cancel-unadopted-candidate'); }
});
