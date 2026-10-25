import type { IntakeCatalogView } from '@shared/content-intake-catalog';
import { formatIntakeDay, remainingLabel } from './intake-time';

export type CatalogAvailability =
  | {
      readonly kind: 'available';
      readonly count: number;
      readonly validUntil: string;
      readonly remaining: string | null;
    }
  | { readonly kind: 'none' };

export function catalogAvailability(
  view: IntakeCatalogView | null,
  fresh: boolean,
  now: number = Date.now(),
): CatalogAvailability {
  if (!fresh || view === null || view.validUntil === null) return { kind: 'none' };
  return {
    kind: 'available',
    count: view.rows.length,
    validUntil: view.validUntil,
    remaining: remainingLabel(view.validUntil, now),
  };
}

export function catalogAvailabilitySentence(availability: CatalogAvailability): string {
  if (availability.kind === 'none') return '暂无有效发布';
  return `当前可用 ${availability.count} 条，到 ${formatIntakeDay(availability.validUntil)} 还能查。`;
}
