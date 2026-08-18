import type { CSSProperties } from 'react';
import {
  QUERY_CLOSE_DURATION_MS,
  QUERY_CONTENT_EXIT_DURATION_MS,
  QUERY_FOX_CENTER_OFFSET_PX,
  QUERY_HANDOFF_SIZE_PX,
  QUERY_OPEN_DURATION_MS,
  type QueryHandoffGeometry,
} from '@shared/fox-motion';
import { QUERY_WIDTH } from '@shared/overlay-geometry';
import type { FoxVisualTransform, QueryAnchor } from '@shared/overlay-events';
import type { OverlayPhase } from '@shared/overlay-machine';
import type { QueryFoxVisualState } from './QueryCapsule';

export const SEARCH_FEEDBACK_MS = 280;
export const COPY_FEEDBACK_MS = 900;
export const DEEP_THINKING_DESCRIPTION =
  'DeepSeek 仅作辅助重排预留，当前 OFF、未接入；不生成、不改写、不发送。';

export function queryFoxVisualState(
  searching: boolean,
  phase: OverlayPhase,
): QueryFoxVisualState {
  if (searching) {
    return 'SEARCHING';
  }
  if (phase === 'RESULTS' || phase === 'EMPTY' || phase === 'COPIED') {
    return phase;
  }
  return 'IDLE';
}

export function queryShellClassName(input: {
  expanded: boolean;
  parked: boolean;
  opening: boolean;
  closing: boolean;
  layoutReady: boolean;
}): string {
  return [
    input.expanded ? 'query-shell is-expanded' : 'query-shell',
    input.parked ? 'is-parked' : '',
    input.opening ? 'is-opening' : '',
    input.closing ? 'is-closing' : '',
    input.layoutReady ? '' : 'is-awaiting-layout',
  ]
    .filter(Boolean)
    .join(' ');
}

export function queryHandoffCssVars(input: {
  geometry: QueryHandoffGeometry;
  foxTransform: FoxVisualTransform;
  anchor: QueryAnchor;
}): CSSProperties {
  const { geometry, foxTransform, anchor } = input;
  return {
    '--query-open-duration': `${QUERY_OPEN_DURATION_MS}ms`,
    '--query-close-duration': `${QUERY_CLOSE_DURATION_MS}ms`,
    '--query-content-exit-duration': `${QUERY_CONTENT_EXIT_DURATION_MS}ms`,
    '--query-handoff-scale-x': geometry.scaleX,
    '--query-handoff-scale-y': geometry.scaleY,
    '--query-handoff-origin-x': `${geometry.originX}px`,
    '--query-handoff-origin-y': `${geometry.originY}px`,
    '--query-handoff-clip-top': `${geometry.clipTop}px`,
    '--query-handoff-clip-right': `${geometry.clipRight}px`,
    '--query-handoff-clip-bottom': `${geometry.clipBottom}px`,
    '--query-handoff-clip-left': `${geometry.clipLeft}px`,
    '--query-handoff-fox-translate-x': `${
      geometry.clipLeft +
      QUERY_HANDOFF_SIZE_PX / 2 -
      (anchor === 'left'
        ? QUERY_FOX_CENTER_OFFSET_PX
        : QUERY_WIDTH - QUERY_FOX_CENTER_OFFSET_PX)
    }px`,
    '--query-handoff-fox-translate-y': `${
      geometry.clipTop +
      QUERY_HANDOFF_SIZE_PX / 2 -
      QUERY_FOX_CENTER_OFFSET_PX
    }px`,
    '--query-handoff-fox-a': foxTransform.a,
    '--query-handoff-fox-b': foxTransform.b,
    '--query-handoff-fox-c': foxTransform.c,
    '--query-handoff-fox-d': foxTransform.d,
    '--query-handoff-fox-e': foxTransform.e,
    '--query-handoff-fox-f': foxTransform.f,
  } as CSSProperties;
}

export function resultCopyRankFromKey(code: string, key: string): 1 | 2 | 3 | null {
  const rank = code.startsWith('Numpad') ? code.slice(-1) : key;
  if (rank !== '1' && rank !== '2' && rank !== '3') {
    return null;
  }
  return Number(rank) as 1 | 2 | 3;
}

export function maxContentBottom(
  nodes: Array<{ getBoundingClientRect(): { bottom: number } } | null | undefined>,
): number {
  let lastContentBottom = 0;
  for (const node of nodes) {
    if (node) {
      lastContentBottom = Math.max(lastContentBottom, node.getBoundingClientRect().bottom);
    }
  }
  return lastContentBottom;
}
