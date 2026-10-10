import { createHash } from 'node:crypto';

export type LinkedPreview = Readonly<{
  objectId: string;
  sha256: string;
  sourceId: string;
  rowId: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: Buffer;
}>;

const byKey = new Map<string, LinkedPreview[]>();

export function stagePreviews(key: string, items: readonly LinkedPreview[]): void {
  if (items.length) byKey.set(key, [...items]);
}

export function adoptPreviews(fromKey: string, toKey: string): void {
  const items = byKey.get(fromKey);
  if (items) byKey.set(toKey, items);
}

/** Drop images that belong only to one unused row. Shared arrays stay for the other rows. */
export function discardPreviewRow(key: string, rowId: string): void {
  const items = byKey.get(key);
  if (!items) return;
  const kept = items.filter(item => item.rowId !== rowId);
  if (kept.length === items.length) return;
  if (kept.length === 0) {
    for (const [stored, value] of byKey) if (value === items) byKey.delete(stored);
    return;
  }
  items.splice(0, items.length, ...kept);
}

/** Drop an unused upload's images, including the earlier object-id copy of the same list. */
export function discardPreviews(key: string): void {
  const items = byKey.get(key);
  if (!items) return;
  for (const [stored, value] of byKey) if (value === items) byKey.delete(stored);
}

export function listPreviews(key: string, sourceIds: ReadonlySet<string>): readonly LinkedPreview[] {
  return (byKey.get(key) ?? []).filter(item => sourceIds.has(item.sourceId));
}

export function openPreview(key: string, objectId: string, sourceIds: ReadonlySet<string>): LinkedPreview | null {
  return listPreviews(key, sourceIds).find(item => item.objectId === objectId) ?? null;
}

export function previewFromBytes(bytes: Buffer, mime: LinkedPreview['mime'], sourceId: string, rowId: string): LinkedPreview {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { objectId: `med_${sha256}`, sha256, sourceId, rowId, mime, bytes };
}
