import { createHash } from 'node:crypto';

export type LinkedPreview = Readonly<{
  objectId: string;
  sha256: string;
  sourceId: string;
  rowId: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: Buffer;
  productRefIds: readonly string[];
  scenarioRefIds: readonly string[];
  familySourceId: string;
}>;

const byKey = new Map<string, LinkedPreview[]>();
const candidateVersions = new Map<string, number>();

type PreviewStage = { previous: LinkedPreview[] | undefined; state: 'pending' | 'rolled-back' | 'settled' };
const stagedHistory = new WeakMap<LinkedPreview[], PreviewStage>();

function projectPreviews(items: LinkedPreview[] | undefined, toKey: string, candidateVersion?: number): void {
  if (candidateVersion !== undefined && (candidateVersions.get(toKey) ?? -1) >= candidateVersion) return;
  if (items) byKey.set(toKey, items);
  if (candidateVersion !== undefined) {
    if (!items) byKey.delete(toKey);
    candidateVersions.set(toKey, candidateVersion);
  }
}

/** Own one immutable input generation. Confirm only this transaction's snapshot;
 * rollback skips rejected predecessors without changing later stages or aliases.
 * Unknown commit outcomes leave the handle unsettled for recovery. */
export function stagePreviews(key: string, items: readonly LinkedPreview[]): {
  rollback(): void;
  commit(toKey: string, candidateVersion?: number): void;
} {
  const staged = [...items];
  const stage: PreviewStage = { previous: byKey.get(key), state: 'pending' };
  stagedHistory.set(staged, stage);
  byKey.set(key, staged);
  return {
    rollback() {
      if (stage.state !== 'pending') return;
      stage.state = 'rolled-back';
      if (byKey.get(key) !== staged) return;
      let previous = stage.previous;
      while (previous) {
        const ancestor = stagedHistory.get(previous);
        if (ancestor?.state !== 'rolled-back') break;
        previous = ancestor.previous;
      }
      if (previous) byKey.set(key, previous);
      else byKey.delete(key);
    },
    commit(toKey, candidateVersion) {
      if (stage.state === 'rolled-back') return;
      // Settle this handle, even if a newer projection wins the version barrier.
      // Never settle whichever transaction happens to occupy the input slot now.
      stage.state = 'settled'; stage.previous = undefined;
      projectPreviews(staged, toKey, candidateVersion);
    },
  };
}

/** Alias an already-owned preview. This does not settle any pending stage. */
export function adoptPreviews(fromKey: string, toKey: string, candidateVersion?: number): void {
  projectPreviews(byKey.get(fromKey), toKey, candidateVersion);
}

/** A deletion receipt contains the remaining row set for its revision. Replaying
 * an older result cannot edit a newer parse. Projecting the whole remaining set
 * also repairs earlier unknown deletions when a later revision commits first. */
export function retainPreviewRowsAtVersion(key: string, rowIds: readonly string[], version: number, inputObjectId?: string): void {
  const current = candidateVersions.get(key);
  if (current !== undefined && current > version) return;
  // Freeze stages immutable input bytes before COMMIT. A confirmed deletion may
  // therefore recover its surviving images before parse has adopted the candidate.
  // Never borrow another candidate generation's bytes based only on row labels.
  // Last-row cancellation retains its version. A same-version older receipt
  // may only shrink the current projection, never restore rows from input.
  const items = byKey.get(current === version ? key : inputObjectId ?? key);
  if (items) {
    const keep = new Set(rowIds);
    const kept = items.filter(item => keep.has(item.rowId));
    if (kept.length) byKey.set(key, kept);
    else byKey.delete(key);
  } else if (inputObjectId !== undefined) {
    byKey.delete(key);
  }
  // Keep the barrier even with no cached bytes. Absence of an image must not let
  // an older in-flight parse resurrect it; only a newer parse can supply bytes.
  candidateVersions.set(key, version);
}

/** Cancel one candidate revision while retaining a version tombstone. Late
 * parses cannot revive it, and an older cancellation cannot erase a newer
 * projection. Only aliases of this exact array are removed. */
export function cancelPreviewsAtVersion(key: string, version: number): void {
  if ((candidateVersions.get(key) ?? -1) > version) return;
  discardPreviews(key);
  candidateVersions.set(key, version);
}

/** Drop images that belong only to one unused row. Shared arrays stay for the other rows. */
export function discardPreviewRow(key: string, rowId: string): void {
  const items = byKey.get(key);
  if (!items) return;
  const kept = items.filter(item => item.rowId !== rowId);
  if (kept.length === items.length) return;
  if (kept.length === 0) {
    for (const [stored, value] of byKey) if (value === items) { byKey.delete(stored); candidateVersions.delete(stored); }
    return;
  }
  items.splice(0, items.length, ...kept);
}

/** Drop an unused upload's images, including the earlier object-id copy of the same list. */
export function discardPreviews(key: string): void {
  const items = byKey.get(key);
  if (!items) return;
  for (const [stored, value] of byKey) if (value === items) { byKey.delete(stored); candidateVersions.delete(stored); }
}

export function listPreviews(key: string, sourceIds: ReadonlySet<string>): readonly LinkedPreview[] {
  return (byKey.get(key) ?? []).filter(item => sourceIds.has(item.sourceId));
}

export function openPreview(key: string, objectId: string, sourceIds: ReadonlySet<string>): LinkedPreview | null {
  return listPreviews(key, sourceIds).find(item => item.objectId === objectId) ?? null;
}

/** Same bytes on another source get another id. The content hash stays `sha256`. */
export function mediaObjectId(sourceId: string, bytes: Buffer): string {
  return `med_${createHash('sha256').update(sourceId).update('\0').update(bytes).digest('hex')}`;
}

export function previewApplies(
  item: Pick<LinkedPreview, 'productRefIds' | 'scenarioRefIds' | 'familySourceId'>,
  filter: { productIds: readonly string[]; scenarioIds: readonly string[] },
  brandScoped: boolean,
): boolean {
  if (filter.productIds.length > 0 && !item.productRefIds.some(id => filter.productIds.includes(id))) return false;
  if (filter.scenarioIds.length > 0 && !item.scenarioRefIds.some(id => filter.scenarioIds.includes(id))) return false;
  return !(brandScoped && item.familySourceId === '' && item.productRefIds.length === 0 && item.scenarioRefIds.length === 0);
}

export function previewFromBytes(
  bytes: Buffer,
  mime: LinkedPreview['mime'],
  sourceId: string,
  rowId: string,
  applicability: { productRefIds?: readonly string[]; scenarioRefIds?: readonly string[]; familySourceId?: string } = {},
): LinkedPreview {
  return {
    objectId: mediaObjectId(sourceId, bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceId,
    rowId,
    mime,
    bytes,
    productRefIds: applicability.productRefIds ?? [],
    scenarioRefIds: applicability.scenarioRefIds ?? [],
    familySourceId: applicability.familySourceId ?? '',
  };
}
