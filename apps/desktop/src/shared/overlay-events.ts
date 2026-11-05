import type { OverlayPhase, OverlaySnapshotProjection } from './overlay-machine';
import { isOverlaySnapshotProjection } from './overlay-machine';
import {
  isOverlayReportIdentity,
  isPositiveOverlayIdentityInteger,
} from './overlay-report';
import { isQueryLayoutAckCommand, type QueryLayoutAckCommand } from './query-layout';

export type OverlayRole = 'fox' | 'query';
export type RendererRole = OverlayRole | 'dashboard' | 'login' | 'sop';

export type FoxVisualTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export const IDENTITY_FOX_VISUAL_TRANSFORM: FoxVisualTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

export const HANDOFF_MILESTONES = [
  'open-armed',
  'open-finished',
  'close-finished',
] as const;
export type HandoffMilestone = (typeof HANDOFF_MILESTONES)[number];

export type OverlayCommand =
  | {
      type: 'prepare-search';
      handoffId: number;
      anchor: QueryAnchor;
      handoffCenterX: number;
      handoffCenterY: number;
      foxVisualTransform: FoxVisualTransform;
    }
  | { type: 'activate-search'; anchor: QueryAnchor; animate: boolean; handoffId?: number }
  | {
      type: 'collapse';
      anchor: QueryAnchor;
      dockEdge: FoxDockEdge;
      animate: boolean;
      handoffId?: number;
      handoffCenterX: number;
      handoffCenterY: number;
    }
  | QueryLayoutAckCommand
  | { type: 'fox-edge'; edge: FoxDockEdge; epoch: number }
  | { type: 'sync-fox-edge'; edge: FoxDockEdge; epoch: number }
  | ({ type: 'fox-drag-settled' } & FoxDragSettleAck)
  | { type: 'sync-query-anchor'; anchor: QueryAnchor }
  | { type: 'overlay-snapshot'; snapshot: OverlaySnapshotProjection }
  | {
      type: 'cancel-query';
      sessionEpoch: number;
      generation: number;
    }
  | {
      type: 'cancel-copy';
      sessionEpoch: number;
      generation: number;
    }
  | { type: 'clear-content' }
  | {
      type: 'shortcut-status';
      registered: boolean;
      accelerator: string;
      message: string;
    };

export type ShortcutStatus = {
  registered: boolean;
  accelerator: string;
  message: string;
};

export type FoxDockEdge = 'none' | 'left' | 'right';
export type FoxDockSnapshot = {
  edge: FoxDockEdge;
  epoch: number;
};
export type FoxDragSettleAck = FoxDockSnapshot & {
  settleId: number;
  generation: number;
};

export function selectAuthoritativeFoxDockSnapshot(
  preferred: FoxDockSnapshot | null | undefined,
  ...candidates: Array<FoxDockSnapshot | null | undefined>
): FoxDockSnapshot | null {
  let latest: FoxDockSnapshot | null = preferred ?? null;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!latest || candidate.epoch > latest.epoch) {
      latest = candidate;
    }
  }
  return latest;
}
export const FOX_PEEK_INTENTS = ['peek', 'retract'] as const;
export type FoxPeekIntent = (typeof FOX_PEEK_INTENTS)[number];
export type QueryAnchor = 'left' | 'right';

export type WindowContext = {
  role: OverlayRole;
  phase: OverlayPhase;
  platform: string;
  shortcut: ShortcutStatus;
  snapshot: OverlaySnapshotProjection;
  testHarness: boolean;
};

export const OVERLAY_EVENT_CHANNEL = 'overlay:event' as const;

export type OverlayRendererEvent =
  | {
      type: 'session-changed';
      sessionEpoch: number;
      nextSessionEpoch: number;
      releaseId: string;
      windowGeneration: number;
      generation: number;
      contentRevision: number;
    }
  | {
      type: 'release-changed';
      releaseId: string;
      sessionEpoch: number;
      windowGeneration: number;
      generation: number;
      contentRevision: number;
      releaseSequence: number;
    }
  | {
      type: 'focus-changed';
      focused: boolean;
      sessionEpoch: number;
      windowGeneration: number;
      generation: number;
      contentRevision: number;
    }
  | {
      type: 'frame-observed';
      commandId: number;
      commandType: 'handoff' | 'layout' | 'settle';
      target: OverlayRole;
      sessionEpoch: number;
      windowGeneration: number;
      generation: number;
      contentRevision: number;
    }
  | {
      type: 'window-recreated';
      sessionEpoch: number;
      windowGeneration: number;
      nextWindowGeneration: number;
      generation: number;
      contentRevision: number;
    };

export type OverlayControlApi = {
  reportOverlayEvent: (event: OverlayRendererEvent) => Promise<OverlaySnapshotProjection | null>;
};

export const REPORTABLE_PHASES = [
  'SEARCH_INPUT',
  'RESULTS',
  'EMPTY',
  'ERROR',
  'COPIED',
] as const;

export type ReportablePhase = (typeof REPORTABLE_PHASES)[number];

export type ResultCount = 0 | 1 | 2 | 3;

export function isRendererRole(value: unknown): value is RendererRole {
  return value === 'fox' || value === 'query' || value === 'dashboard' || value === 'login' || value === 'sop';
}

export function isReportablePhase(value: unknown): value is ReportablePhase {
  return value === 'SEARCH_INPUT'
    || value === 'RESULTS'
    || value === 'EMPTY'
    || value === 'ERROR'
    || value === 'COPIED';
}

export function isResultCount(value: unknown): value is ResultCount {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function isFoxPeekIntent(value: unknown): value is FoxPeekIntent {
  return value === 'peek' || value === 'retract';
}

export function isFoxPeekEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isFoxDragGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isFoxDragSettleId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isFoxDragSettleAck(value: unknown): value is FoxDragSettleAck {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<FoxDragSettleAck>;
  return (
    (candidate.edge === 'none' || candidate.edge === 'left' || candidate.edge === 'right')
    && isFoxPeekEpoch(candidate.epoch)
    && isFoxDragSettleId(candidate.settleId)
    && isFoxDragGeneration(candidate.generation)
  );
}

export function isHandoffId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isHandoffMilestone(value: unknown): value is HandoffMilestone {
  return HANDOFF_MILESTONES.includes(value as HandoffMilestone);
}

export function isFoxVisualTransform(value: unknown): value is FoxVisualTransform {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Object.keys(value).length !== 6) {
    return false;
  }
  const matrix = value as Partial<FoxVisualTransform>;
  const linear = [matrix.a, matrix.b, matrix.c, matrix.d];
  const translation = [matrix.e, matrix.f];
  const determinant =
    typeof matrix.a === 'number' &&
    typeof matrix.b === 'number' &&
    typeof matrix.c === 'number' &&
    typeof matrix.d === 'number'
      ? matrix.a * matrix.d - matrix.b * matrix.c
      : Number.NaN;
  return (
    linear.every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 2,
    ) &&
    translation.every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 48,
    ) &&
    Number.isFinite(determinant) &&
    determinant >= 0.25 &&
    determinant <= 4
  );
}

function isHandoffCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 4096;
}

export function canRequestFoxPeek(
  trusted: boolean,
  role: OverlayRole | null,
  intent: unknown,
): intent is FoxPeekIntent {
  return trusted && role === 'fox' && isFoxPeekIntent(intent);
}

export function isOverlayCommand(value: unknown): value is OverlayCommand {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { type?: unknown };
  if (record.type === 'prepare-search') {
    const command = value as {
      handoffId?: unknown;
      anchor?: unknown;
      handoffCenterX?: unknown;
      handoffCenterY?: unknown;
      foxVisualTransform?: unknown;
    };
    return (
      isHandoffId(command.handoffId) &&
      (command.anchor === 'left' || command.anchor === 'right') &&
      isHandoffCoordinate(command.handoffCenterX) &&
      isHandoffCoordinate(command.handoffCenterY) &&
      isFoxVisualTransform(command.foxVisualTransform)
    );
  }
  if (record.type === 'collapse') {
    const command = value as {
      anchor?: unknown;
      dockEdge?: unknown;
      animate?: unknown;
      handoffId?: unknown;
      handoffCenterX?: unknown;
      handoffCenterY?: unknown;
    };
    return (
      (command.anchor === 'left' || command.anchor === 'right') &&
      (command.dockEdge === 'none' || command.dockEdge === 'left' || command.dockEdge === 'right') &&
      typeof command.animate === 'boolean' &&
      (command.handoffId === undefined || isHandoffId(command.handoffId)) &&
      isHandoffCoordinate(command.handoffCenterX) &&
      isHandoffCoordinate(command.handoffCenterY)
    );
  }
  if (record.type === 'query-layout-ack') {
    return isQueryLayoutAckCommand(value);
  }
  if (record.type === 'activate-search') {
    const command = value as { anchor?: unknown; animate?: unknown; handoffId?: unknown };
    return (
      (command.anchor === 'left' || command.anchor === 'right') &&
      typeof command.animate === 'boolean' &&
      (command.handoffId === undefined || isHandoffId(command.handoffId))
    );
  }
  if (record.type === 'fox-edge' || record.type === 'sync-fox-edge') {
    const command = value as { edge?: unknown; epoch?: unknown };
    return (
      (command.edge === 'none' || command.edge === 'left' || command.edge === 'right') &&
      isFoxPeekEpoch(command.epoch)
    );
  }
  if (record.type === 'fox-drag-settled') {
    return isFoxDragSettleAck(value);
  }
  if (record.type === 'sync-query-anchor') {
    const command = value as { anchor?: unknown };
    return command.anchor === 'left' || command.anchor === 'right';
  }
  if (record.type === 'overlay-snapshot') {
    return hasExactKeys(value, ['type', 'snapshot'])
      && isOverlaySnapshotProjection((value as { snapshot?: unknown }).snapshot);
  }
  if (record.type === 'cancel-query' || record.type === 'cancel-copy') {
    const command = value as { sessionEpoch?: unknown; generation?: unknown };
    return hasExactKeys(value, ['type', 'sessionEpoch', 'generation'])
      && isPositiveOverlayIdentityInteger(command.sessionEpoch)
      && isPositiveOverlayIdentityInteger(command.generation);
  }
  if (record.type === 'clear-content') {
    return hasExactKeys(value, ['type']);
  }
  if (record.type === 'shortcut-status') {
    const status = value as {
      registered?: unknown;
      accelerator?: unknown;
      message?: unknown;
    };
    return (
      typeof status.registered === 'boolean' &&
      typeof status.accelerator === 'string' &&
      typeof status.message === 'string'
    );
  }
  return false;
}

export function isOverlayRendererEvent(value: unknown): value is OverlayRendererEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const event = value as Partial<OverlayRendererEvent>;
  const identity = {
    sessionEpoch: event.sessionEpoch,
    generation: event.generation,
    windowGeneration: event.windowGeneration,
    contentRevision: event.contentRevision,
  };
  if (!isOverlayReportIdentity(identity)) return false;
  if (event.type === 'session-changed' || event.type === 'release-changed') {
    const keys = event.type === 'session-changed'
      ? ['type', 'sessionEpoch', 'nextSessionEpoch', 'releaseId', 'windowGeneration', 'generation', 'contentRevision']
      : ['type', 'sessionEpoch', 'releaseId', 'windowGeneration', 'generation', 'contentRevision', 'releaseSequence'];
    return hasExactKeys(value, keys)
      && typeof event.releaseId === 'string'
      && event.releaseId.length > 0
      && (
        event.type !== 'release-changed'
        || (
          Number.isSafeInteger(event.releaseSequence)
          && (event.releaseSequence ?? -1) >= 0
        )
      )
      && (
        event.type !== 'session-changed'
        || (
          isPositiveOverlayIdentityInteger(event.nextSessionEpoch)
          && event.nextSessionEpoch > (event.sessionEpoch ?? 0)
        )
      );
  }
  if (event.type === 'focus-changed') {
    return hasExactKeys(value, ['type', 'focused', 'sessionEpoch', 'windowGeneration', 'generation', 'contentRevision'])
      && typeof event.focused === 'boolean';
  }
  if (event.type === 'window-recreated') {
    return hasExactKeys(value, ['type', 'sessionEpoch', 'windowGeneration', 'nextWindowGeneration', 'generation', 'contentRevision'])
      && isPositiveOverlayIdentityInteger(event.nextWindowGeneration)
      && event.nextWindowGeneration > (event.windowGeneration ?? 0);
  }
  return event.type === 'frame-observed'
    && hasExactKeys(value, [
      'type',
      'commandId',
      'commandType',
      'target',
      'sessionEpoch',
      'windowGeneration',
      'generation',
      'contentRevision',
    ])
    && isHandoffId(event.commandId)
    && (event.commandType === 'handoff' || event.commandType === 'layout' || event.commandType === 'settle')
    && (event.target === 'fox' || event.target === 'query');
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function prepareSearchCommand(input: {
  handoffId: number;
  anchor: QueryAnchor;
  handoffCenterX: number;
  handoffCenterY: number;
  foxVisualTransform: FoxVisualTransform;
}): Extract<OverlayCommand, { type: 'prepare-search' }> {
  return {
    type: 'prepare-search',
    handoffId: input.handoffId,
    anchor: input.anchor,
    handoffCenterX: input.handoffCenterX,
    handoffCenterY: input.handoffCenterY,
    foxVisualTransform: input.foxVisualTransform,
  };
}

export function activateSearchCommand(
  anchor: QueryAnchor,
  animate: boolean,
  handoffId?: number,
): Extract<OverlayCommand, { type: 'activate-search' }> {
  return handoffId === undefined
    ? { type: 'activate-search', anchor, animate }
    : { type: 'activate-search', anchor, animate, handoffId };
}

export function collapseQueryCommand(input: {
  handoffId: number;
  anchor: QueryAnchor;
  dockEdge: FoxDockEdge;
  animate: boolean;
  handoffCenterX: number;
  handoffCenterY: number;
}): Extract<OverlayCommand, { type: 'collapse' }> {
  return {
    type: 'collapse',
    handoffId: input.handoffId,
    anchor: input.anchor,
    dockEdge: input.dockEdge,
    animate: input.animate,
    handoffCenterX: input.handoffCenterX,
    handoffCenterY: input.handoffCenterY,
  };
}

export function foxEdgeCommand(
  edge: FoxDockEdge,
  epoch: number,
): Extract<OverlayCommand, { type: 'fox-edge' }> {
  return { type: 'fox-edge', edge, epoch };
}

export function syncFoxEdgeCommand(
  edge: FoxDockEdge,
  epoch: number,
): Extract<OverlayCommand, { type: 'sync-fox-edge' }> {
  return { type: 'sync-fox-edge', edge, epoch };
}

export function syncQueryAnchorCommand(
  anchor: QueryAnchor,
): Extract<OverlayCommand, { type: 'sync-query-anchor' }> {
  return { type: 'sync-query-anchor', anchor };
}

export function shortcutStatusCommand(input: {
  registered: boolean;
  accelerator: string;
  message: string;
}): Extract<OverlayCommand, { type: 'shortcut-status' }> {
  return {
    type: 'shortcut-status',
    registered: input.registered,
    accelerator: input.accelerator,
    message: input.message,
  };
}

export function foxDragSettledCommand(
  ack: FoxDragSettleAck,
): Extract<OverlayCommand, { type: 'fox-drag-settled' }> {
  return { type: 'fox-drag-settled', ...ack };
}
