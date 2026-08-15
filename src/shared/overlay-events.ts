import { isOverlayPhase, type OverlayPhase } from './overlay-machine';

export type OverlayRole = 'fox' | 'query';
export type RendererRole = OverlayRole | 'dashboard';

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
    }
  | { type: 'fox-edge'; edge: FoxDockEdge; epoch: number }
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
export const FOX_PEEK_INTENTS = ['peek', 'retract'] as const;
export type FoxPeekIntent = (typeof FOX_PEEK_INTENTS)[number];
export type QueryAnchor = 'left' | 'right';

export type WindowContext = {
  role: OverlayRole;
  phase: OverlayPhase;
  shortcut: ShortcutStatus;
  testHarness: boolean;
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
  return value === 'fox' || value === 'query' || value === 'dashboard';
}

export function isReportablePhase(value: unknown): value is ReportablePhase {
  return isOverlayPhase(value) && value !== 'FOX_IDLE';
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
    };
    return (
      (command.anchor === 'left' || command.anchor === 'right') &&
      (command.dockEdge === 'none' || command.dockEdge === 'left' || command.dockEdge === 'right') &&
      typeof command.animate === 'boolean' &&
      (command.handoffId === undefined || isHandoffId(command.handoffId))
    );
  }
  if (record.type === 'activate-search') {
    const command = value as { anchor?: unknown; animate?: unknown; handoffId?: unknown };
    return (
      (command.anchor === 'left' || command.anchor === 'right') &&
      typeof command.animate === 'boolean' &&
      (command.handoffId === undefined || isHandoffId(command.handoffId))
    );
  }
  if (record.type === 'fox-edge') {
    const command = value as { edge?: unknown; epoch?: unknown };
    return (
      (command.edge === 'none' || command.edge === 'left' || command.edge === 'right') &&
      isFoxPeekEpoch(command.epoch)
    );
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
