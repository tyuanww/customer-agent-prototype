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
