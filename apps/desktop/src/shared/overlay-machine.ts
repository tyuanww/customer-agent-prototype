export const OVERLAY_PHASES = [
  'FOX_IDLE',
  'SEARCH_INPUT',
  'RESULTS',
  'EMPTY',
  'ERROR',
  'COPIED',
] as const;

export type OverlayPhase = (typeof OVERLAY_PHASES)[number];

export type OverlayEvent =
  | { type: 'OPEN' }
  | { type: 'DISMISS' }
  | { type: 'TOGGLE' }
  | { type: 'QUERY_BLANK' }
  | { type: 'QUERY_HIT' }
  | { type: 'QUERY_EMPTY' }
  | { type: 'QUERY_ERROR' }
  | { type: 'COPIED' }
  | { type: 'RETRY' };

export const OPEN_PHASES: readonly OverlayPhase[] = [
  'SEARCH_INPUT',
  'RESULTS',
  'EMPTY',
  'ERROR',
  'COPIED',
];

export function isOverlayPhase(value: unknown): value is OverlayPhase {
  return typeof value === 'string' && (OVERLAY_PHASES as readonly string[]).includes(value);
}

export function isOpenPhase(phase: OverlayPhase): boolean {
  return phase !== 'FOX_IDLE';
}

export function reduceOverlay(phase: OverlayPhase, event: OverlayEvent): OverlayPhase {
  switch (event.type) {
    case 'OPEN':
      return phase === 'FOX_IDLE' ? 'SEARCH_INPUT' : phase;
    case 'DISMISS':
      return 'FOX_IDLE';
    case 'TOGGLE':
      return phase === 'FOX_IDLE' ? 'SEARCH_INPUT' : 'FOX_IDLE';
    case 'QUERY_BLANK':
      return isOpenPhase(phase) ? 'SEARCH_INPUT' : phase;
    case 'QUERY_HIT':
      return isOpenPhase(phase) ? 'RESULTS' : phase;
    case 'QUERY_EMPTY':
      return isOpenPhase(phase) ? 'EMPTY' : phase;
    case 'QUERY_ERROR':
      return isOpenPhase(phase) ? 'ERROR' : phase;
    case 'COPIED':
      return phase === 'RESULTS' || phase === 'COPIED' ? 'COPIED' : phase;
    case 'RETRY':
      if (phase === 'ERROR') {
        return 'SEARCH_INPUT';
      }
      if (phase === 'COPIED') {
        return 'RESULTS';
      }
      return phase;
    default:
      return phase;
  }
}

export function shouldExpandPanel(phase: OverlayPhase): boolean {
  return phase === 'RESULTS' || phase === 'EMPTY' || phase === 'ERROR' || phase === 'COPIED';
}
