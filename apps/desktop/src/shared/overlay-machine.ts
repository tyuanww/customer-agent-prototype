import type {
  FoxDockEdge,
  FoxDragSettleAck,
  FoxPeekIntent,
  FoxVisualTransform,
  HandoffMilestone,
  OverlayCommand,
  QueryAnchor,
  ReportablePhase,
  ResultCount,
} from './overlay-events';
import type { Rect } from './overlay-geometry';

export const OVERLAY_CONTENT_PHASES = [
  'SEARCH_INPUT',
  'RESULTS',
  'EMPTY',
  'ERROR',
  'COPIED',
] as const;
export type OverlayContentPhase = (typeof OVERLAY_CONTENT_PHASES)[number];

/** Compatibility alias for renderer props that only need a query content phase. */
export type OverlayPhase = OverlayContentPhase | 'FOX_IDLE';

export const OVERLAY_LIFECYCLE_PHASES = [
  'parked',
  'opening',
  'active',
  'closing',
  'closed',
] as const;
export type OverlayLifecyclePhase = (typeof OVERLAY_LIFECYCLE_PHASES)[number];
export type OverlaySurface = 'fox' | 'query';
export type OverlayFocusIntent = 'fox' | 'query' | 'previous-app' | 'none';
export type OverlayHandoffMode = 'none' | 'preparing-open' | 'opening' | 'closing';
export type OverlayTimer = 'handoff' | 'layout' | 'drag-settle' | 'blur';
export type QueryResizeEdge = 'top' | 'bottom';

export type OverlayState = {
  readonly phase: OverlayLifecyclePhase;
  readonly activeSurface: OverlaySurface;
  readonly contentPhase: OverlayContentPhase;
  readonly resultCount: ResultCount;
  readonly sessionEpoch: number;
  readonly generation: number;
  readonly windowGeneration: number;
  readonly releaseId: string;
  readonly focusIntent: OverlayFocusIntent;
  readonly handoff: {
    readonly id: number;
    readonly sequence: number;
    readonly mode: OverlayHandoffMode;
    readonly anchor: QueryAnchor;
    readonly generation: number;
    readonly sessionEpoch: number;
    readonly animate: boolean;
  };
  readonly layout: {
    readonly sequence: number;
    readonly ackSequence: number;
    readonly handoffId: number;
    readonly desiredHeight: number | null;
    readonly appliedHeight: number | null;
    readonly resizeEdge: QueryResizeEdge;
    readonly resize: {
      readonly handoffId: number;
      readonly lastSequence: number;
      readonly baselineHeight: number;
      readonly edge: QueryResizeEdge;
    } | null;
  };
  readonly drag: {
    readonly generation: number;
    readonly session: {
      readonly generation: number;
      readonly windowGeneration: number;
      readonly sessionEpoch: number;
      readonly displayId: number;
      readonly target: OverlaySurface;
    } | null;
    readonly settle: {
      readonly id: number;
      readonly generation: number;
      readonly windowGeneration: number;
      readonly sessionEpoch: number;
      readonly displayId: number;
      readonly target: OverlaySurface;
      readonly bounds: Rect;
      readonly edge: FoxDockEdge;
    } | null;
    readonly pendingOpen: OverlayOpenPlan | null;
    readonly queryAnchor: QueryAnchor | null;
  };
  readonly fox: {
    readonly edge: FoxDockEdge;
    readonly peekEpoch: number;
    readonly peekIntent: FoxPeekIntent;
  };
  readonly shortcut: {
    readonly registered: boolean;
    readonly accelerator: string;
    readonly message: string;
  };
};

/**
 * The desktop snapshot is the single renderer projection. `contract` is the
 * ARC-01 overlay shape; the remaining fields are the UI-only projection of the
 * same authoritative state and are never reconstructed independently.
 */
export type OverlaySnapshot = {
  readonly contract: {
    readonly role: OverlaySurface;
    readonly sessionEpoch: number;
    readonly generation: number;
    readonly phase: OverlayLifecyclePhase;
    readonly activeSurface: OverlaySurface;
    readonly handoffSequence: number;
    readonly layoutSequence: number;
    readonly releaseId: string;
  };
  readonly contentPhase: OverlayContentPhase;
  readonly resultCount: ResultCount;
  readonly windowGeneration: number;
  readonly focusIntent: OverlayFocusIntent;
  readonly handoff: OverlayState['handoff'];
  readonly layout: OverlayState['layout'];
  readonly drag: OverlayState['drag'];
  readonly fox: OverlayState['fox'];
  readonly shortcut: OverlayState['shortcut'];
};

type EventGuard = {
  sessionEpoch: number;
  generation: number;
  windowGeneration: number;
};

export type OverlayOpenPlan = EventGuard & {
  anchor: QueryAnchor;
  dockEdge: FoxDockEdge;
  queryBounds: Rect;
  foxBounds: Rect;
  handoffCenterX: number;
  handoffCenterY: number;
  foxVisualTransform: FoxVisualTransform;
  animate: boolean;
};

export type OverlayEvent =
  | ({ type: 'OPEN_REQUESTED' } & OverlayOpenPlan)
  | ({
      type: 'DISMISS_REQUESTED';
      restorePreviousApp: boolean;
      animate: boolean;
      handoffCenterX: number;
      handoffCenterY: number;
    } & EventGuard)
  | ({ type: 'TOGGLE_REQUESTED' } & EventGuard)
  | ({ type: 'QUERY_SUBSCRIBED' } & EventGuard)
  | ({ type: 'HANDOFF_ARMED'; handoffId: number } & EventGuard)
  | ({ type: 'HANDOFF_OPENED'; handoffId: number } & EventGuard)
  | ({ type: 'HANDOFF_CLOSED'; handoffId: number } & EventGuard)
  | ({ type: 'HANDOFF_TIMEOUT'; handoffId: number } & EventGuard)
  | ({ type: 'HANDOFF_CANCELLED'; handoffId: number } & EventGuard)
  | ({
      type: 'CONTENT_CHANGED';
      contentPhase: ReportablePhase;
      resultCount: ResultCount;
    } & EventGuard)
  | ({ type: 'SESSION_CHANGED'; releaseId: string } & EventGuard)
  | ({ type: 'RELEASE_CHANGED'; releaseId: string } & EventGuard)
  | ({ type: 'WINDOW_RECREATED' } & EventGuard)
  | ({ type: 'WINDOW_CLOSED' } & EventGuard)
  | ({ type: 'QUERY_FOCUSED' } & EventGuard)
  | ({ type: 'QUERY_BLURRED' } & EventGuard)
  | ({ type: 'FOCUS_RESTORED' } & EventGuard)
  | ({
      type: 'LAYOUT_REQUESTED';
      handoffId: number;
      sequence: number;
      desiredHeight: number;
      contentPhase: ReportablePhase;
      resultCount: ResultCount;
    } & EventGuard)
  | ({
      type: 'QUERY_LAYOUT_ACK';
      handoffId: number;
      sequence: number;
      height: number;
      resizeEdge: QueryResizeEdge;
      contentPhase: ReportablePhase;
      resultCount: ResultCount;
    } & EventGuard)
  | ({ type: 'LAYOUT_TIMEOUT'; handoffId: number; sequence: number } & EventGuard)
  | ({
      type: 'RESIZE_BEGIN';
      handoffId: number;
      sequence: number;
      baselineHeight: number;
      edge: QueryResizeEdge;
    } & EventGuard)
  | ({
      type: 'RESIZE_UPDATE';
      handoffId: number;
      sequence: number;
      height: number;
      edge: QueryResizeEdge;
    } & EventGuard)
  | ({
      type: 'RESIZE_END';
      handoffId: number;
      sequence: number;
      height: number;
      commit: boolean;
    } & EventGuard)
  | ({
      type: 'RESIZE_KEYBOARD';
      handoffId: number;
      sequence: number;
      height: number;
      edge: QueryResizeEdge;
    } & EventGuard)
  | ({
      type: 'FOX_DRAG_MOVED';
      dragGeneration: number;
      target?: OverlaySurface;
      dx: number;
      dy: number;
      nextBounds: Rect;
      displayId?: number;
      queryAnchor?: QueryAnchor;
    } & EventGuard)
  | ({
      type: 'FOX_DRAG_ENDED';
      dragGeneration: number;
      target?: OverlaySurface;
      settledBounds: Rect;
      edge: FoxDockEdge;
      settleId: number;
      displayId: number;
    } & EventGuard)
  | ({ type: 'FOX_DRAG_SETTLE_COMMITTED'; dragGeneration: number; settleId: number } & EventGuard)
  | ({ type: 'FOX_DRAG_TIMEOUT'; dragGeneration: number } & EventGuard)
  | ({ type: 'QUERY_DRAG_CLEARED' } & EventGuard)
  | ({
      type: 'DISPLAY_CHANGED';
      displayId: number;
      edge?: FoxDockEdge;
      foxBounds?: Rect;
      queryBounds?: Rect;
    } & EventGuard)
  | ({
      type: 'FOX_EDGE_SYNCED';
      edge: FoxDockEdge;
      peekEpoch: number;
    } & EventGuard)
  | ({
      type: 'FOX_PEEK_CHANGED';
      intent: FoxPeekIntent;
      peekEpoch: number;
    } & EventGuard)
  | ({
      type: 'SHORTCUT_STATUS_CHANGED';
      registered: boolean;
      accelerator: string;
      message: string;
    } & EventGuard)
  | ({
      type: 'RENDERER_FRAME_OBSERVED';
      commandId: number;
      target: OverlaySurface;
      frame: HandoffMilestone | 'snapshot';
    } & EventGuard);

export const OVERLAY_EVENT_TYPES = [
  'OPEN_REQUESTED',
  'DISMISS_REQUESTED',
  'TOGGLE_REQUESTED',
  'QUERY_SUBSCRIBED',
  'HANDOFF_ARMED',
  'HANDOFF_OPENED',
  'HANDOFF_CLOSED',
  'HANDOFF_TIMEOUT',
  'HANDOFF_CANCELLED',
  'CONTENT_CHANGED',
  'SESSION_CHANGED',
  'RELEASE_CHANGED',
  'WINDOW_RECREATED',
  'WINDOW_CLOSED',
  'QUERY_FOCUSED',
  'QUERY_BLURRED',
  'FOCUS_RESTORED',
  'LAYOUT_REQUESTED',
  'QUERY_LAYOUT_ACK',
  'LAYOUT_TIMEOUT',
  'RESIZE_BEGIN',
  'RESIZE_UPDATE',
  'RESIZE_END',
  'RESIZE_KEYBOARD',
  'FOX_DRAG_MOVED',
  'FOX_DRAG_ENDED',
  'FOX_DRAG_SETTLE_COMMITTED',
  'FOX_DRAG_TIMEOUT',
  'QUERY_DRAG_CLEARED',
  'DISPLAY_CHANGED',
  'FOX_EDGE_SYNCED',
  'FOX_PEEK_CHANGED',
  'SHORTCUT_STATUS_CHANGED',
  'RENDERER_FRAME_OBSERVED',
] as const satisfies readonly OverlayEvent['type'][];
export type OverlayEventType = (typeof OVERLAY_EVENT_TYPES)[number];

export type NativeEffect =
  | {
      readonly type: 'SEND_RENDERER_COMMAND';
      readonly target: OverlaySurface;
      readonly commandId: number;
      readonly command: OverlayCommand;
    }
  | {
      readonly type: 'SET_WINDOW_BOUNDS';
      readonly target: OverlaySurface;
      readonly bounds: Rect;
      readonly windowGeneration: number;
    }
  | {
      readonly type: 'SHOW_WINDOW';
      readonly target: OverlaySurface;
      readonly activate: boolean;
      readonly windowGeneration: number;
    }
  | {
      readonly type: 'HIDE_WINDOW';
      readonly target: OverlaySurface;
      readonly windowGeneration: number;
    }
  | {
      readonly type: 'FOCUS_WINDOW';
      readonly target: OverlaySurface;
      readonly sessionEpoch: number;
      readonly windowGeneration: number;
    }
  | {
      readonly type: 'RESTORE_PREVIOUS_APP';
      readonly sessionEpoch: number;
      readonly windowGeneration: number;
    }
  | {
      readonly type: 'SET_FOCUSABLE';
      readonly target: OverlaySurface;
      readonly focusable: boolean;
    }
  | {
      readonly type: 'SCHEDULE_TIMEOUT';
      readonly timer: OverlayTimer;
      readonly handoffId: number;
      readonly delayMs: number;
    }
  | {
      readonly type: 'CANCEL_TIMEOUT';
      readonly timer: OverlayTimer;
      readonly handoffId?: number;
    }
  | {
      readonly type: 'CANCEL_QUERY';
      readonly sessionEpoch: number;
      readonly generation: number;
    }
  | {
      readonly type: 'CANCEL_COPY';
      readonly sessionEpoch: number;
      readonly generation: number;
    }
  | { readonly type: 'CLEAR_CONTENT' }
  | { readonly type: 'APPLY_QUERY_LAYOUT'; readonly desiredHeight: number }
  | {
      readonly type: 'APPLY_RESIZE';
      readonly height: number;
      readonly edge: QueryResizeEdge;
    }
  | { readonly type: 'REFRESH_QUERY_SHADOW' }
  | {
      readonly type: 'FOX_DRAG_SETTLED';
      readonly ack: FoxDragSettleAck;
    }
  | {
      readonly type: 'SYNC_FOX_EDGE';
      readonly edge: FoxDockEdge;
      readonly peekEpoch: number;
    }
  | {
      readonly type: 'PUBLISH_SNAPSHOT';
      readonly snapshot: OverlaySnapshot;
    };

export type OverlayDecision = 'applied' | 'ignored' | 'rejected';
export type OverlayRejection =
  | 'stale-window'
  | 'stale-session'
  | 'stale-generation'
  | 'stale-handoff'
  | 'stale-layout'
  | 'stale-drag-session'
  | 'stale-drag-settle'
  | 'awaiting-drag-settle'
  | 'drag-settle-pending'
  | 'invalid-phase'
  | 'invalid-event'
  | 'no-transition';

export type OverlayTransition = {
  readonly state: OverlayState;
  readonly effects: readonly NativeEffect[];
  readonly decision: OverlayDecision;
  readonly reason?: OverlayRejection;
  readonly snapshot: OverlaySnapshot;
};

const NO_EFFECTS: readonly NativeEffect[] = Object.freeze([]);
const HANDOFF_TIMEOUT_MS = 280;
const LAYOUT_TIMEOUT_MS = 160;
const DRAG_TIMEOUT_MS = 1_600;

export function createInitialOverlayState(input: {
  sessionEpoch: number;
  generation: number;
  windowGeneration: number;
  releaseId: string;
}): OverlayState {
  return {
    phase: 'parked',
    activeSurface: 'fox',
    contentPhase: 'SEARCH_INPUT',
    resultCount: 0,
    sessionEpoch: input.sessionEpoch,
    generation: input.generation,
    windowGeneration: input.windowGeneration,
    releaseId: input.releaseId,
    focusIntent: 'fox',
    handoff: {
      id: 0,
      sequence: 0,
      mode: 'none',
      anchor: 'left',
      generation: input.generation,
      sessionEpoch: input.sessionEpoch,
      animate: true,
    },
    layout: {
      sequence: 0,
      ackSequence: 0,
      handoffId: 0,
      desiredHeight: null,
      appliedHeight: null,
      resizeEdge: 'bottom',
      resize: null,
    },
    drag: {
      generation: 0,
      session: null,
      settle: null,
      pendingOpen: null,
      queryAnchor: null,
    },
    fox: {
      edge: 'none',
      peekEpoch: 0,
      peekIntent: 'retract',
    },
    shortcut: {
      registered: false,
      accelerator: 'CommandOrControl+Shift+Space',
      message: '',
    },
  };
}

export function overlaySnapshot(state: OverlayState): OverlaySnapshot {
  return {
    contract: {
      role: state.activeSurface,
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      phase: state.phase,
      activeSurface: state.activeSurface,
      handoffSequence: state.handoff.sequence,
      layoutSequence: state.layout.sequence,
      releaseId: state.releaseId,
    },
    contentPhase: state.contentPhase,
    resultCount: state.resultCount,
    windowGeneration: state.windowGeneration,
    focusIntent: state.focusIntent,
    handoff: state.handoff,
    layout: state.layout,
    drag: state.drag,
    fox: state.fox,
    shortcut: state.shortcut,
  };
}

export function isOverlaySnapshot(value: unknown): value is OverlaySnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const snapshot = value as Partial<OverlaySnapshot>;
  const contract = snapshot.contract;
  const handoff = snapshot.handoff as Partial<OverlayState['handoff']> | undefined;
  const layout = snapshot.layout as Partial<OverlayState['layout']> | undefined;
  const drag = snapshot.drag as Partial<OverlayState['drag']> | undefined;
  const fox = snapshot.fox as Partial<OverlayState['fox']> | undefined;
  const shortcut = snapshot.shortcut as Partial<OverlayState['shortcut']> | undefined;
  const resize = layout?.resize as Partial<NonNullable<OverlayState['layout']['resize']>> | null | undefined;
  const dragSession = drag?.session as Partial<NonNullable<OverlayState['drag']['session']>> | null | undefined;
  const dragSettle = drag?.settle as Partial<NonNullable<OverlayState['drag']['settle']>> | null | undefined;
  return Boolean(
    contract
    && (contract.role === 'fox' || contract.role === 'query')
    && contract.activeSurface === contract.role
    && isPositiveInteger(contract.sessionEpoch)
    && isPositiveInteger(contract.generation)
    && (contract.phase === 'parked'
      || contract.phase === 'opening'
      || contract.phase === 'active'
      || contract.phase === 'closing'
      || contract.phase === 'closed')
    && Number.isSafeInteger(contract.handoffSequence)
    && Number.isSafeInteger(contract.layoutSequence)
    && typeof contract.releaseId === 'string'
    && contract.releaseId.length > 0
    && isOverlayContentPhase(snapshot.contentPhase)
    && (snapshot.resultCount === 0
      || snapshot.resultCount === 1
      || snapshot.resultCount === 2
      || snapshot.resultCount === 3)
    && isPositiveInteger(snapshot.windowGeneration)
    && (snapshot.focusIntent === 'fox'
      || snapshot.focusIntent === 'query'
      || snapshot.focusIntent === 'previous-app'
      || snapshot.focusIntent === 'none')
    && handoff
    && Number.isSafeInteger(handoff.id)
    && (handoff.id ?? -1) >= 0
    && Number.isSafeInteger(handoff.sequence)
    && (handoff.sequence ?? -1) >= 0
    && (handoff.mode === 'none'
      || handoff.mode === 'preparing-open'
      || handoff.mode === 'opening'
      || handoff.mode === 'closing')
    && (handoff.anchor === 'left' || handoff.anchor === 'right')
    && isPositiveInteger(handoff.generation)
    && isPositiveInteger(handoff.sessionEpoch)
    && typeof handoff.animate === 'boolean'
    && layout
    && Number.isSafeInteger(layout.sequence)
    && (layout.sequence ?? -1) >= 0
    && Number.isSafeInteger(layout.ackSequence)
    && (layout.ackSequence ?? -1) >= 0
    && Number.isSafeInteger(layout.handoffId)
    && (layout.handoffId ?? -1) >= 0
    && (
      layout.desiredHeight === null
      || (typeof layout.desiredHeight === 'number' && Number.isFinite(layout.desiredHeight))
    )
    && (
      layout.appliedHeight === null
      || (typeof layout.appliedHeight === 'number' && Number.isFinite(layout.appliedHeight))
    )
    && (layout.resizeEdge === 'top' || layout.resizeEdge === 'bottom')
    && (
      resize === null
      || (
        resize
        && isPositiveInteger(resize.handoffId)
        && isPositiveInteger(resize.lastSequence)
        && typeof resize.baselineHeight === 'number'
        && Number.isFinite(resize.baselineHeight)
        && (resize.edge === 'top' || resize.edge === 'bottom')
      )
    )
    && drag
    && Number.isSafeInteger(drag.generation)
    && (drag.generation ?? -1) >= 0
    && (
      dragSession === null
      || (
        dragSession
        && isPositiveInteger(dragSession.generation)
        && isPositiveInteger(dragSession.windowGeneration)
        && isPositiveInteger(dragSession.sessionEpoch)
        && Number.isSafeInteger(dragSession.displayId)
        && (dragSession.target === 'fox' || dragSession.target === 'query')
      )
    )
    && (
      dragSettle === null
      || (
        dragSettle
        && isPositiveInteger(dragSettle.id)
        && isPositiveInteger(dragSettle.generation)
        && isPositiveInteger(dragSettle.windowGeneration)
        && isPositiveInteger(dragSettle.sessionEpoch)
        && Number.isSafeInteger(dragSettle.displayId)
        && isRect(dragSettle.bounds)
        && (
          dragSettle.edge === 'none'
          || dragSettle.edge === 'left'
          || dragSettle.edge === 'right'
        )
        && (dragSettle.target === 'fox' || dragSettle.target === 'query')
      )
    )
    && (
      drag.pendingOpen === null
      || Boolean(drag.pendingOpen)
    )
    && (drag.queryAnchor === null || drag.queryAnchor === 'left' || drag.queryAnchor === 'right')
    && fox
    && (fox.edge === 'none' || fox.edge === 'left' || fox.edge === 'right')
    && Number.isSafeInteger(fox.peekEpoch)
    && (fox.peekEpoch ?? -1) >= 0
    && (fox.peekIntent === 'peek' || fox.peekIntent === 'retract')
    && shortcut
    && typeof shortcut.registered === 'boolean'
    && typeof shortcut.accelerator === 'string'
    && typeof shortcut.message === 'string',
  );
}

export function isOverlayContentPhase(value: unknown): value is OverlayContentPhase {
  return typeof value === 'string'
    && (OVERLAY_CONTENT_PHASES as readonly string[]).includes(value);
}

export function isOverlayPhase(value: unknown): value is OverlayPhase {
  return value === 'FOX_IDLE' || isOverlayContentPhase(value);
}

export function isOpenPhase(phase: OverlayPhase): boolean {
  return phase !== 'FOX_IDLE';
}

export function shouldExpandPanel(phase: OverlayPhase): boolean {
  return phase === 'RESULTS' || phase === 'EMPTY' || phase === 'ERROR' || phase === 'COPIED';
}

function transition(
  state: OverlayState,
  decision: OverlayDecision,
  effects: readonly NativeEffect[] = NO_EFFECTS,
  reason?: OverlayRejection,
): OverlayTransition {
  const snapshot = overlaySnapshot(state);
  const published = decision === 'applied'
    ? [...effects, { type: 'PUBLISH_SNAPSHOT', snapshot } as const]
    : effects;
  return { state, effects: Object.freeze(published), decision, reason, snapshot };
}

function applied(state: OverlayState, effects: readonly NativeEffect[] = NO_EFFECTS): OverlayTransition {
  return transition(state, 'applied', effects);
}

function ignored(state: OverlayState, reason: OverlayRejection): OverlayTransition {
  return transition(state, 'ignored', NO_EFFECTS, reason);
}

function rejected(state: OverlayState, reason: OverlayRejection): OverlayTransition {
  return transition(state, 'rejected', NO_EFFECTS, reason);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const rect = value as Partial<Rect>;
  return [rect.x, rect.y, rect.width, rect.height].every(
    (entry) => typeof entry === 'number' && Number.isFinite(entry),
  ) && (rect.width ?? 0) > 0 && (rect.height ?? 0) > 0;
}

function isOpenPlan(event: Extract<OverlayEvent, { type: 'OPEN_REQUESTED' }>): boolean {
  return (
    (event.anchor === 'left' || event.anchor === 'right')
    && (event.dockEdge === 'none' || event.dockEdge === 'left' || event.dockEdge === 'right')
    && isRect(event.queryBounds)
    && isRect(event.foxBounds)
    && Number.isFinite(event.handoffCenterX)
    && Number.isFinite(event.handoffCenterY)
    && typeof event.animate === 'boolean'
    && Boolean(event.foxVisualTransform)
  );
}

function resetContent(state: OverlayState): OverlayState {
  return {
    ...state,
    contentPhase: 'SEARCH_INPUT',
    resultCount: 0,
    layout: {
      ...state.layout,
      sequence: 0,
      ackSequence: 0,
      desiredHeight: null,
      appliedHeight: null,
      resize: null,
    },
  };
}

function startOpening(
  state: OverlayState,
  plan: OverlayOpenPlan,
): OverlayTransition {
  const generation = state.generation + 1;
  const sequence = state.handoff.sequence + 1;
  const handoffId = sequence;
  const next: OverlayState = {
    ...resetContent(state),
    phase: 'opening',
    activeSurface: 'fox',
    focusIntent: 'query',
    generation,
    handoff: {
      id: handoffId,
      sequence,
      mode: 'preparing-open',
      anchor: plan.anchor,
      generation,
      sessionEpoch: state.sessionEpoch,
      animate: plan.animate,
    },
    layout: {
      ...state.layout,
      handoffId,
      resizeEdge: 'bottom',
    },
    drag: {
      ...state.drag,
      pendingOpen: null,
    },
  };
  return applied(next, [
    {
      type: 'SEND_RENDERER_COMMAND',
      target: 'query',
      commandId: handoffId,
      command: {
        type: 'prepare-search',
        handoffId,
        anchor: plan.anchor,
        handoffCenterX: plan.handoffCenterX,
        handoffCenterY: plan.handoffCenterY,
        foxVisualTransform: plan.foxVisualTransform,
      },
    },
    { type: 'SET_WINDOW_BOUNDS', target: 'query', bounds: plan.queryBounds, windowGeneration: state.windowGeneration },
    { type: 'SET_FOCUSABLE', target: 'fox', focusable: false },
    { type: 'SCHEDULE_TIMEOUT', timer: 'handoff', handoffId, delayMs: HANDOFF_TIMEOUT_MS },
  ]);
}

/**
 * The reducer is the only place that may decide an overlay transition. Native
 * consumers execute the returned effects; they never infer a next phase.
 */
export function applyOverlayEvent(
  state: OverlayState,
  event: OverlayEvent,
): OverlayTransition {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    return rejected(state, 'invalid-event');
  }

  if (event.type === 'WINDOW_RECREATED') {
    if (
      !isPositiveInteger(event.windowGeneration)
      || event.windowGeneration <= state.windowGeneration
    ) {
      return rejected(state, 'stale-window');
    }
    const next = createInitialOverlayState({
      sessionEpoch: Math.max(state.sessionEpoch, event.sessionEpoch),
      generation: state.generation + 1,
      windowGeneration: event.windowGeneration,
      releaseId: 'rel_overlay_unbound',
    });
    return applied(next, [
      { type: 'CANCEL_TIMEOUT', timer: 'handoff' },
      { type: 'CANCEL_TIMEOUT', timer: 'layout' },
      { type: 'CANCEL_TIMEOUT', timer: 'drag-settle' },
      { type: 'SHOW_WINDOW', target: 'fox', activate: false, windowGeneration: next.windowGeneration },
      { type: 'HIDE_WINDOW', target: 'query', windowGeneration: next.windowGeneration },
    ]);
  }

  if (event.windowGeneration !== state.windowGeneration) {
    return rejected(state, 'stale-window');
  }
  if (event.sessionEpoch < state.sessionEpoch) {
    return rejected(state, 'stale-session');
  }
  if (event.sessionEpoch > state.sessionEpoch && event.type !== 'SESSION_CHANGED') {
    return rejected(state, 'stale-session');
  }
  if (event.generation !== state.generation) {
    return rejected(state, 'stale-generation');
  }

  switch (event.type) {
    case 'OPEN_REQUESTED': {
      if (!isOpenPlan(event)) {
        return rejected(state, 'invalid-event');
      }
      if (state.phase !== 'parked') {
        return ignored(state, 'no-transition');
      }
      if (state.drag.session || state.drag.settle) {
        return transition(
          { ...state, drag: { ...state.drag, pendingOpen: event } },
          'ignored',
          NO_EFFECTS,
          'awaiting-drag-settle',
        );
      }
      return startOpening(state, event);
    }

    case 'DISMISS_REQUESTED': {
      if (state.phase !== 'active' && state.phase !== 'opening') {
        return ignored(state, 'invalid-phase');
      }
      const generation = state.generation + 1;
      const sequence = state.handoff.sequence + 1;
      const handoffId = sequence;
      const next: OverlayState = {
        ...resetContent(state),
        phase: 'closing',
        activeSurface: 'query',
        generation,
        focusIntent: event.restorePreviousApp ? 'previous-app' : 'none',
        handoff: {
          ...state.handoff,
          id: handoffId,
          sequence,
          mode: 'closing',
          generation,
          sessionEpoch: state.sessionEpoch,
          animate: event.animate,
        },
        layout: {
          ...state.layout,
          handoffId,
          sequence: 0,
          ackSequence: 0,
          resize: null,
        },
      };
      return applied(next, [
        {
          type: 'SEND_RENDERER_COMMAND',
          target: 'query',
          commandId: handoffId,
          command: {
            type: 'collapse',
            handoffId,
            anchor: state.handoff.anchor,
            dockEdge: state.fox.edge,
            animate: event.animate,
            handoffCenterX: event.handoffCenterX,
            handoffCenterY: event.handoffCenterY,
          },
        },
        { type: 'SCHEDULE_TIMEOUT', timer: 'handoff', handoffId, delayMs: HANDOFF_TIMEOUT_MS },
      ]);
    }

    case 'TOGGLE_REQUESTED':
      return ignored(state, 'no-transition');

    case 'QUERY_SUBSCRIBED':
      return state.phase === 'opening' && state.handoff.mode === 'preparing-open'
        ? applied(state, [{
            type: 'SEND_RENDERER_COMMAND',
            target: 'query',
            commandId: state.handoff.id,
            command: {
              type: 'prepare-search',
              handoffId: state.handoff.id,
              anchor: state.handoff.anchor,
              handoffCenterX: 0,
              handoffCenterY: 0,
              foxVisualTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
            },
          }])
        : ignored(state, 'invalid-phase');

    case 'HANDOFF_ARMED': {
      if (
        state.phase !== 'opening'
        || state.handoff.mode !== 'preparing-open'
        || !isPositiveInteger(event.handoffId)
        || event.handoffId !== state.handoff.id
      ) {
        return rejected(state, 'stale-handoff');
      }
      const next: OverlayState = {
        ...state,
        activeSurface: 'query',
        handoff: { ...state.handoff, mode: 'opening' },
        focusIntent: 'query',
      };
      return applied(next, [
        { type: 'CANCEL_TIMEOUT', timer: 'handoff', handoffId: event.handoffId },
        { type: 'SHOW_WINDOW', target: 'query', activate: true, windowGeneration: state.windowGeneration },
        { type: 'HIDE_WINDOW', target: 'fox', windowGeneration: state.windowGeneration },
        { type: 'FOCUS_WINDOW', target: 'query', sessionEpoch: state.sessionEpoch, windowGeneration: state.windowGeneration },
        {
          type: 'SEND_RENDERER_COMMAND',
          target: 'query',
          commandId: event.handoffId,
          command: {
            type: 'activate-search',
            anchor: state.handoff.anchor,
            animate: state.handoff.animate,
            handoffId: event.handoffId,
          },
        },
        { type: 'SCHEDULE_TIMEOUT', timer: 'handoff', handoffId: event.handoffId, delayMs: HANDOFF_TIMEOUT_MS },
      ]);
    }

    case 'HANDOFF_OPENED': {
      if (
        state.handoff.mode !== 'opening'
        || !isPositiveInteger(event.handoffId)
        || event.handoffId !== state.handoff.id
      ) {
        return rejected(state, 'stale-handoff');
      }
      const next: OverlayState = {
        ...state,
        phase: 'active',
        activeSurface: 'query',
        focusIntent: 'query',
        handoff: { ...state.handoff, mode: 'none' },
      };
      return applied(next, [
        { type: 'CANCEL_TIMEOUT', timer: 'handoff', handoffId: event.handoffId },
        { type: 'REFRESH_QUERY_SHADOW' },
      ]);
    }

    case 'HANDOFF_CLOSED': {
      if (
        state.phase !== 'closing'
        || state.handoff.mode !== 'closing'
        || !isPositiveInteger(event.handoffId)
        || event.handoffId !== state.handoff.id
      ) {
        return rejected(state, 'stale-handoff');
      }
      const next: OverlayState = {
        ...resetContent(state),
        phase: 'parked',
        activeSurface: 'fox',
        focusIntent: state.focusIntent === 'previous-app' ? 'previous-app' : 'fox',
        generation: state.generation + 1,
        handoff: {
          ...state.handoff,
          mode: 'none',
          generation: state.generation + 1,
        },
      };
      const effects: NativeEffect[] = [
        { type: 'CANCEL_TIMEOUT', timer: 'handoff', handoffId: event.handoffId },
        { type: 'SHOW_WINDOW', target: 'fox', activate: false, windowGeneration: state.windowGeneration },
        { type: 'HIDE_WINDOW', target: 'query', windowGeneration: state.windowGeneration },
        { type: 'SET_FOCUSABLE', target: 'query', focusable: false },
      ];
      if (next.focusIntent === 'previous-app') {
        effects.push({
          type: 'RESTORE_PREVIOUS_APP',
          sessionEpoch: state.sessionEpoch,
          windowGeneration: state.windowGeneration,
        });
      }
      return applied(next, effects);
    }

    case 'HANDOFF_TIMEOUT': {
      if (!isPositiveInteger(event.handoffId) || event.handoffId !== state.handoff.id) {
        return rejected(state, 'stale-handoff');
      }
      if (state.handoff.mode === 'preparing-open') {
        const next: OverlayState = {
          ...state,
          activeSurface: 'query',
          handoff: { ...state.handoff, mode: 'opening' },
          focusIntent: 'query',
        };
        return applied(next, [
          { type: 'CANCEL_TIMEOUT', timer: 'handoff', handoffId: event.handoffId },
          { type: 'SHOW_WINDOW', target: 'query', activate: true, windowGeneration: state.windowGeneration },
          { type: 'HIDE_WINDOW', target: 'fox', windowGeneration: state.windowGeneration },
          { type: 'FOCUS_WINDOW', target: 'query', sessionEpoch: state.sessionEpoch, windowGeneration: state.windowGeneration },
          {
            type: 'SEND_RENDERER_COMMAND',
            target: 'query',
            commandId: state.handoff.id,
            command: { type: 'activate-search', anchor: state.handoff.anchor, animate: false, handoffId: state.handoff.id },
          },
        ]);
      }
      if (state.handoff.mode === 'opening') {
        return applyOverlayEvent(state, { ...event, type: 'HANDOFF_OPENED' });
      }
      if (state.handoff.mode === 'closing') {
        return applyOverlayEvent(state, { ...event, type: 'HANDOFF_CLOSED' });
      }
      return ignored(state, 'no-transition');
    }

    case 'HANDOFF_CANCELLED': {
      if (!isPositiveInteger(event.handoffId) || event.handoffId !== state.handoff.id) {
        return rejected(state, 'stale-handoff');
      }
      const next: OverlayState = {
        ...state,
        generation: state.generation + 1,
        handoff: {
          ...state.handoff,
          mode: 'none',
          generation: state.generation + 1,
        },
        focusIntent: state.phase === 'closing' ? 'previous-app' : 'query',
      };
      return applied(next, [
        { type: 'CANCEL_TIMEOUT', timer: 'handoff', handoffId: event.handoffId },
      ]);
    }

    case 'CONTENT_CHANGED': {
      if (
        (state.phase !== 'active' && state.phase !== 'opening')
        || !isOverlayContentPhase(event.contentPhase)
        || !(event.resultCount === 0 || event.resultCount === 1 || event.resultCount === 2 || event.resultCount === 3)
      ) {
        return ignored(state, 'invalid-phase');
      }
      return applied({
        ...state,
        contentPhase: event.contentPhase,
        resultCount: event.resultCount,
        generation: state.generation + 1,
      });
    }

    case 'SESSION_CHANGED': {
      if (!isPositiveInteger(event.sessionEpoch) || event.sessionEpoch <= state.sessionEpoch) {
        return rejected(state, 'stale-session');
      }
      const cancelling = [
        { type: 'CANCEL_QUERY', sessionEpoch: state.sessionEpoch, generation: state.generation },
        { type: 'CANCEL_COPY', sessionEpoch: state.sessionEpoch, generation: state.generation },
        { type: 'CLEAR_CONTENT' },
      ] as const satisfies readonly NativeEffect[];
      const sessionChanged = {
        ...resetContent(state),
        sessionEpoch: event.sessionEpoch,
        generation: state.generation + 1,
        releaseId: event.releaseId,
        handoff: {
          ...state.handoff,
          generation: state.generation + 1,
          sessionEpoch: event.sessionEpoch,
        },
        layout: {
          ...state.layout,
          sequence: 0,
          ackSequence: 0,
          resize: null,
        },
        drag: {
          ...state.drag,
          session: null,
          settle: null,
          pendingOpen: null,
          queryAnchor: null,
        },
      } satisfies OverlayState;
      if (state.phase === 'closing') {
        const forcedParked: OverlayState = {
          ...sessionChanged,
          phase: 'parked',
          activeSurface: 'fox',
          focusIntent: 'previous-app',
          handoff: {
            ...state.handoff,
            mode: 'none',
            generation: state.generation + 1,
            sessionEpoch: event.sessionEpoch,
          },
        };
        return applied(forcedParked, [
          ...cancelling,
          { type: 'CANCEL_TIMEOUT', timer: 'handoff' },
          { type: 'SHOW_WINDOW', target: 'fox', activate: false, windowGeneration: state.windowGeneration },
          { type: 'HIDE_WINDOW', target: 'query', windowGeneration: state.windowGeneration },
          { type: 'RESTORE_PREVIOUS_APP', sessionEpoch: event.sessionEpoch, windowGeneration: state.windowGeneration },
        ]);
      }
      if (state.phase === 'active' || state.phase === 'opening') {
        return applied(
          { ...sessionChanged, focusIntent: 'query' },
          [
            ...cancelling,
            { type: 'FOCUS_WINDOW', target: 'query', sessionEpoch: event.sessionEpoch, windowGeneration: state.windowGeneration },
          ],
        );
      }
      return applied({ ...sessionChanged, focusIntent: 'fox' }, cancelling);
    }

    case 'RELEASE_CHANGED':
      return event.releaseId
        ? applied({ ...state, releaseId: event.releaseId, generation: state.generation + 1 })
        : rejected(state, 'invalid-event');

    case 'WINDOW_CLOSED': {
      if (state.phase === 'closed') {
        return ignored(state, 'no-transition');
      }
      const next: OverlayState = {
        ...createInitialOverlayState({
          sessionEpoch: state.sessionEpoch,
          generation: state.generation + 1,
          windowGeneration: state.windowGeneration,
          releaseId: state.releaseId,
        }),
        phase: 'closed',
        activeSurface: 'fox',
        focusIntent: 'none',
      };
      return applied(next, [
        { type: 'CANCEL_TIMEOUT', timer: 'handoff' },
        { type: 'CANCEL_TIMEOUT', timer: 'layout' },
        { type: 'CANCEL_TIMEOUT', timer: 'drag-settle' },
      ]);
    }

    case 'QUERY_FOCUSED':
      if (state.phase !== 'active' && state.phase !== 'opening') {
        return ignored(state, 'invalid-phase');
      }
      return applied({ ...state, focusIntent: 'query' });

    case 'QUERY_BLURRED':
      if (state.phase !== 'active' && state.phase !== 'opening') {
        return ignored(state, 'invalid-phase');
      }
      return applied({ ...state, focusIntent: 'none' });

    case 'FOCUS_RESTORED':
      return state.focusIntent === 'previous-app'
        ? applied({ ...state, focusIntent: 'fox' })
        : ignored(state, 'no-transition');

    case 'LAYOUT_REQUESTED': {
      if (
        state.phase !== 'active'
        || state.handoff.mode !== 'none'
        || !isPositiveInteger(event.handoffId)
        || event.handoffId !== state.handoff.id
        || !isPositiveInteger(event.sequence)
        || event.sequence <= state.layout.sequence
        || !Number.isFinite(event.desiredHeight)
      ) {
        return rejected(state, 'stale-layout');
      }
      const next: OverlayState = {
        ...state,
        layout: {
          ...state.layout,
          sequence: event.sequence,
          handoffId: event.handoffId,
          desiredHeight: event.desiredHeight,
        },
      };
      return applied(next, [
        { type: 'APPLY_QUERY_LAYOUT', desiredHeight: event.desiredHeight },
        { type: 'SCHEDULE_TIMEOUT', timer: 'layout', handoffId: event.handoffId, delayMs: LAYOUT_TIMEOUT_MS },
      ]);
    }

    case 'QUERY_LAYOUT_ACK': {
      if (
        state.phase !== 'active'
        || event.handoffId !== state.handoff.id
        || event.sequence < state.layout.sequence
        || event.sequence <= state.layout.ackSequence
        || !Number.isFinite(event.height)
        || (event.resizeEdge !== 'top' && event.resizeEdge !== 'bottom')
      ) {
        return rejected(state, 'stale-layout');
      }
      return applied({
        ...state,
        layout: {
          ...state.layout,
          ackSequence: event.sequence,
          appliedHeight: event.height,
          resizeEdge: event.resizeEdge,
        },
      }, [{ type: 'CANCEL_TIMEOUT', timer: 'layout', handoffId: event.handoffId }]);
    }

    case 'LAYOUT_TIMEOUT':
      return state.phase === 'active' && event.handoffId === state.handoff.id
        ? applied(state, [{ type: 'CANCEL_TIMEOUT', timer: 'layout', handoffId: event.handoffId }])
        : rejected(state, 'stale-layout');

    case 'RESIZE_BEGIN': {
      if (
        state.phase !== 'active'
        || event.handoffId !== state.handoff.id
        || state.layout.resize
        || !isPositiveInteger(event.sequence)
        || event.sequence <= state.layout.sequence
        || !Number.isFinite(event.baselineHeight)
      ) {
        return rejected(state, 'stale-layout');
      }
      return applied({
        ...state,
        layout: {
          ...state.layout,
          sequence: event.sequence,
          resize: {
            handoffId: event.handoffId,
            lastSequence: event.sequence,
            baselineHeight: event.baselineHeight,
            edge: event.edge,
          },
        },
      });
    }

    case 'RESIZE_UPDATE': {
      const resize = state.layout.resize;
      if (
        state.phase !== 'active'
        || !resize
        || resize.handoffId !== event.handoffId
        || event.handoffId !== state.handoff.id
        || event.sequence <= resize.lastSequence
        || !Number.isFinite(event.height)
      ) {
        return rejected(state, 'stale-layout');
      }
      return applied({
        ...state,
        layout: {
          ...state.layout,
          sequence: event.sequence,
          resize: { ...resize, lastSequence: event.sequence, edge: event.edge },
        },
      }, [{ type: 'APPLY_RESIZE', height: event.height, edge: event.edge }]);
    }

    case 'RESIZE_END': {
      const resize = state.layout.resize;
      if (
        state.phase !== 'active'
        || !resize
        || resize.handoffId !== event.handoffId
        || event.handoffId !== state.handoff.id
        || event.sequence <= resize.lastSequence
        || !Number.isFinite(event.height)
      ) {
        return rejected(state, 'stale-layout');
      }
      const height = event.commit ? event.height : resize.baselineHeight;
      return applied({
        ...state,
        layout: {
          ...state.layout,
          sequence: event.sequence,
          ackSequence: event.sequence,
          appliedHeight: height,
          resizeEdge: resize.edge,
          resize: null,
        },
      }, [{ type: 'APPLY_RESIZE', height, edge: resize.edge }]);
    }

    case 'RESIZE_KEYBOARD':
      if (
        state.phase !== 'active'
        || state.layout.resize
        || event.handoffId !== state.handoff.id
        || !isPositiveInteger(event.sequence)
        || event.sequence <= state.layout.sequence
        || !Number.isFinite(event.height)
      ) {
        return rejected(state, 'stale-layout');
      }
      return applied({
        ...state,
        layout: {
          ...state.layout,
          sequence: event.sequence,
          ackSequence: event.sequence,
          appliedHeight: event.height,
          resizeEdge: event.edge,
        },
      }, [{ type: 'APPLY_RESIZE', height: event.height, edge: event.edge }]);

    case 'FOX_DRAG_MOVED': {
      if (!isPositiveInteger(event.dragGeneration) || !isRect(event.nextBounds)) {
        return rejected(state, 'invalid-event');
      }
      if (state.drag.session && state.drag.session.generation !== event.dragGeneration) {
        return rejected(state, 'stale-drag-session');
      }
      // A new pointer generation supersedes any uncommitted final frame. Its
      // stale ACK must not clear the newer drag or consume pending open.
      const next: OverlayState = {
        ...state,
        drag: {
          ...state.drag,
          generation: event.dragGeneration,
          settle: state.drag.settle?.generation === event.dragGeneration
            ? state.drag.settle
            : null,
          queryAnchor: event.target === 'query'
            ? state.drag.queryAnchor ?? event.queryAnchor ?? state.handoff.anchor
            : state.drag.queryAnchor,
          session: state.drag.session ?? {
            generation: event.dragGeneration,
            windowGeneration: state.windowGeneration,
            sessionEpoch: state.sessionEpoch,
            displayId: event.displayId ?? 0,
            target: event.target ?? 'fox',
          },
        },
      };
      return applied(next, [{
        type: 'SET_WINDOW_BOUNDS',
        target: event.target ?? 'fox',
        bounds: event.nextBounds,
        windowGeneration: state.windowGeneration,
      }]);
    }

    case 'FOX_DRAG_ENDED': {
      const session = state.drag.session;
      if (
        !session
        || session.generation !== event.dragGeneration
        || session.windowGeneration !== state.windowGeneration
        || session.sessionEpoch !== state.sessionEpoch
        || !isPositiveInteger(event.settleId)
        || !isRect(event.settledBounds)
      ) {
        return rejected(state, 'stale-drag-session');
      }
      if (session.target === 'query') {
        return applied({
          ...state,
          drag: {
            ...state.drag,
            generation: event.dragGeneration,
            session: null,
            settle: null,
            queryAnchor: state.drag.queryAnchor ?? state.handoff.anchor,
          },
          fox: {
            ...state.fox,
            edge: event.edge,
            peekEpoch: state.fox.peekEpoch + 1,
            peekIntent: 'retract',
          },
        }, [
          {
            type: 'SET_WINDOW_BOUNDS',
            target: 'query',
            bounds: event.settledBounds,
            windowGeneration: state.windowGeneration,
          },
          {
            type: 'SYNC_FOX_EDGE',
            edge: event.edge,
            peekEpoch: state.fox.peekEpoch + 1,
          },
        ]);
      }
      if (state.drag.settle) {
        return rejected(state, 'stale-drag-settle');
      }
      const next: OverlayState = {
        ...state,
        generation: state.generation + 1,
        drag: {
          ...state.drag,
          session: null,
          settle: {
            id: event.settleId,
            generation: event.dragGeneration,
            windowGeneration: state.windowGeneration,
            sessionEpoch: state.sessionEpoch,
            displayId: event.displayId,
            target: session.target,
            bounds: event.settledBounds,
            edge: event.edge,
          },
        },
        fox: {
          ...state.fox,
          edge: event.edge,
          peekEpoch: state.fox.peekEpoch + 1,
          peekIntent: 'retract',
        },
      };
      const ack: FoxDragSettleAck = {
        edge: event.edge,
        epoch: next.fox.peekEpoch,
        generation: event.dragGeneration,
        settleId: event.settleId,
      };
      return applied(next, [
        {
          type: 'SET_WINDOW_BOUNDS',
          target: 'fox',
          bounds: event.settledBounds,
          windowGeneration: state.windowGeneration,
        },
        { type: 'FOX_DRAG_SETTLED', ack },
        { type: 'SCHEDULE_TIMEOUT', timer: 'drag-settle', handoffId: event.settleId, delayMs: DRAG_TIMEOUT_MS },
      ]);
    }

    case 'FOX_DRAG_SETTLE_COMMITTED': {
      const settle = state.drag.settle;
      if (state.drag.session !== null) {
        return rejected(state, 'stale-drag-session');
      }
      if (
        !settle
        || settle.id !== event.settleId
        || settle.generation !== event.dragGeneration
        || settle.windowGeneration !== state.windowGeneration
        || settle.sessionEpoch !== state.sessionEpoch
      ) {
        return rejected(state, 'stale-drag-settle');
      }
      const cleared: OverlayState = {
        ...state,
        drag: { ...state.drag, settle: null },
      };
      const cancelled = {
        type: 'CANCEL_TIMEOUT',
        timer: 'drag-settle',
        handoffId: settle.id,
      } as const;
      if (state.drag.pendingOpen) {
        const opening = startOpening(cleared, {
          ...state.drag.pendingOpen,
          generation: cleared.generation,
          sessionEpoch: cleared.sessionEpoch,
          windowGeneration: cleared.windowGeneration,
        });
        return {
          ...opening,
          effects: Object.freeze([cancelled, ...opening.effects]),
        };
      }
      return applied(cleared, [cancelled]);
    }

    case 'FOX_DRAG_TIMEOUT': {
      const session = state.drag.session;
      const settle = state.drag.settle;
      if (
        (!session || session.generation !== event.dragGeneration)
        && (!settle || settle.generation !== event.dragGeneration)
      ) {
        return rejected(state, 'stale-drag-session');
      }
      return applied({
        ...state,
        drag: { ...state.drag, session: null, settle: null },
      }, [{ type: 'CANCEL_TIMEOUT', timer: 'drag-settle' }]);
    }

    case 'QUERY_DRAG_CLEARED':
      return state.drag.queryAnchor === null
        ? ignored(state, 'no-transition')
        : applied({
            ...state,
            drag: { ...state.drag, queryAnchor: null },
          });

    case 'DISPLAY_CHANGED': {
      if (state.drag.session || state.drag.settle) {
        return rejected(state, 'drag-settle-pending');
      }
      if (
        !event.foxBounds
        || !isRect(event.foxBounds)
        || (event.queryBounds !== undefined && !isRect(event.queryBounds))
        || !event.edge
      ) {
        return rejected(state, 'invalid-event');
      }
      const peekEpoch = state.fox.peekEpoch + 1;
      const next: OverlayState = {
        ...state,
        fox: {
          edge: event.edge,
          peekEpoch,
          peekIntent: 'retract',
        },
      };
      const effects: NativeEffect[] = [
        {
          type: 'SET_WINDOW_BOUNDS',
          target: 'fox',
          bounds: event.foxBounds,
          windowGeneration: state.windowGeneration,
        },
        { type: 'SYNC_FOX_EDGE', edge: event.edge, peekEpoch },
      ];
      if (event.queryBounds) {
        effects.push({
          type: 'SET_WINDOW_BOUNDS',
          target: 'query',
          bounds: event.queryBounds,
          windowGeneration: state.windowGeneration,
        });
      }
      return applied(next, effects);
    }

    case 'FOX_EDGE_SYNCED': {
      if (
        (event.edge !== 'none' && event.edge !== 'left' && event.edge !== 'right')
        || !Number.isSafeInteger(event.peekEpoch)
        || event.peekEpoch < state.fox.peekEpoch
      ) {
        return rejected(state, 'invalid-event');
      }
      const next: OverlayState = {
        ...state,
        fox: {
          edge: event.edge,
          peekEpoch: event.peekEpoch,
          peekIntent: 'retract',
        },
      };
      return applied(next, [{
        type: 'SYNC_FOX_EDGE',
        edge: event.edge,
        peekEpoch: event.peekEpoch,
      }]);
    }

    case 'FOX_PEEK_CHANGED':
      if (
        state.phase !== 'parked'
        || event.peekEpoch !== state.fox.peekEpoch
        || (event.intent !== 'peek' && event.intent !== 'retract')
      ) {
        return ignored(state, 'no-transition');
      }
      return applied({ ...state, fox: { ...state.fox, peekIntent: event.intent } });

    case 'SHORTCUT_STATUS_CHANGED':
      return applied({
        ...state,
        shortcut: {
          registered: event.registered,
          accelerator: event.accelerator,
          message: event.message,
        },
      });

    case 'RENDERER_FRAME_OBSERVED':
      return applied(state);
  }
}
