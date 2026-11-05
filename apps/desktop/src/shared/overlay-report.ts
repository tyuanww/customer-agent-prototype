/**
 * Identity attached to every renderer report. Main compares these values with
 * the authoritative state instead of rebuilding the report from a newer state.
 */
export type OverlayReportIdentity = {
  readonly sessionEpoch: number;
  readonly generation: number;
  readonly windowGeneration: number;
  readonly contentRevision: number;
};

export function isPositiveOverlayIdentityInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isOverlayReportIdentity(value: unknown): value is OverlayReportIdentity {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const identity = value as Partial<OverlayReportIdentity>;
  return Object.keys(value).length === 4
    && isPositiveOverlayIdentityInteger(identity.sessionEpoch)
    && isPositiveOverlayIdentityInteger(identity.generation)
    && isPositiveOverlayIdentityInteger(identity.windowGeneration)
    && Number.isSafeInteger(identity.contentRevision)
    && (identity.contentRevision ?? -1) >= 0;
}
