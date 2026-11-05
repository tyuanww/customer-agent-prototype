import type { OverlaySnapshotProjection } from '../../shared/overlay-machine';
import {
  subscribeDashboardReleaseInvalidation,
  type DashboardControlPlane,
  type DashboardReleaseInvalidation,
} from '../dashboard-control-plane';
import { dashboardControlPlaneForSession } from '../dashboard-control-plane';
import type { ProductSession } from '../product-session';
import { createQuerySessionAdapter } from './query-api-adapter';

export type OverlayInvalidationWork = Readonly<{
  cancelQuery(identity: Readonly<{ sessionEpoch: number; generation: number }>): void;
  cancelCopy(identity: Readonly<{ sessionEpoch: number; generation: number }>): void;
  clearContent(): void;
}>;

export type DesktopComposition = Readonly<{
  querySession: ProductSession;
  dashboard: DashboardControlPlane;
  dispose(): void;
}>;

/**
 * DSH emits a durable, deduplicated event. The composition layer translates
 * it into the existing typed Query commands. It never broadcasts arbitrary
 * payloads and never mutates overlay state itself.
 */
export function bindDashboardReleaseInvalidation(input: Readonly<{
  getOverlaySnapshot: () => OverlaySnapshotProjection | null;
  work: OverlayInvalidationWork;
}>): (value: DashboardReleaseInvalidation) => void {
  const handled = new Set<string>();
  return (value) => {
    const snapshot = input.getOverlaySnapshot();
    if (!snapshot) return;
    if (value.sessionEpoch !== snapshot.contract.sessionEpoch) return;
    if (handled.has(value.dedupeKey)) return;
    // releaseId is durable identity, not an ordering value. A same-session
    // event for a different release still invalidates the current content;
    // the next authoritative query result owns the release identity update.
    const identity = { sessionEpoch: snapshot.contract.sessionEpoch, generation: snapshot.contract.generation };
    input.work.cancelQuery(identity);
    input.work.cancelCopy(identity);
    input.work.clearContent();
    handled.add(value.dedupeKey);
  };
}

export function createDesktopComposition(input: Readonly<{
  session: ProductSession;
  userDataDirectory: string;
  getOverlaySnapshot: () => OverlaySnapshotProjection | null;
  work: OverlayInvalidationWork;
}>): DesktopComposition {
  const dashboard = dashboardControlPlaneForSession(input.session, input.userDataDirectory);
  const querySession = createQuerySessionAdapter(input.session);
  const releaseInvalidation = bindDashboardReleaseInvalidation({
    getOverlaySnapshot: input.getOverlaySnapshot,
    work: input.work,
  });
  const unsubscribe = subscribeDashboardReleaseInvalidation(releaseInvalidation);
  return {
    querySession,
    dashboard,
    dispose: unsubscribe,
  };
}
