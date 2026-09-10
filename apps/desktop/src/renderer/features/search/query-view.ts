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
import type { ProductSessionResult } from '@shared/product-session';

export type QueryFoxVisualState = 'SEARCHING' | 'RESULTS' | 'EMPTY' | 'COPIED' | 'IDLE';

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

export type SessionNoticeKind = 'unsigned' | 'expired' | 'success' | 'failed';
export type SessionNotice = { kind: SessionNoticeKind; text: string };
export type SessionNoticeSource = 'status' | 'login' | 'logout';

export const SESSION_NOTICE_TEXT = {
  unsigned: '请先合成登录',
  loggedOut: '已退出，请先登录',
  success: '合成登录成功，可以直接查询；需要时再筛选平台和商品',
  expired: '登录已失效，请重新登录',
} as const;

export function sessionNoticeForResult(input: {
  value: ProductSessionResult;
  source: SessionNoticeSource;
  wasSignedIn: boolean;
  previous: SessionNotice | null;
}): SessionNotice | null {
  const { value, source, wasSignedIn, previous } = input;
  if (!value.ok) {
    if (source === 'login' || source === 'logout') {
      return { kind: 'failed', text: value.message };
    }
    if (value.code === 'UNAUTHORIZED' || value.code === 'GONE' || wasSignedIn) {
      return { kind: 'expired', text: SESSION_NOTICE_TEXT.expired };
    }
    return { kind: 'failed', text: value.message };
  }
  if (value.enabled && !value.signedIn) {
    if (source === 'logout') {
      return { kind: 'unsigned', text: SESSION_NOTICE_TEXT.loggedOut };
    }
    if (wasSignedIn) {
      return { kind: 'expired', text: SESSION_NOTICE_TEXT.expired };
    }
    if (source === 'status' && (previous?.kind === 'unsigned' || previous?.kind === 'failed')) {
      return previous;
    }
    return { kind: 'unsigned', text: SESSION_NOTICE_TEXT.unsigned };
  }
  if (value.signedIn) {
    if (source === 'login') {
      return { kind: 'success', text: SESSION_NOTICE_TEXT.success };
    }
    return previous?.kind === 'success' ? previous : null;
  }
  return null;
}
