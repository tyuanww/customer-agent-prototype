import type { RendererRole } from './overlay-events';

export const OPEN_DASHBOARD_FAILURE_MESSAGE = '工作台未打开，请重试。查询窗口仍保持可用。';

export type OpenDashboardResult =
  | { ok: true }
  | { ok: false; message: string };

export function canOpenDashboard(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return input.trusted && input.role === 'query';
}

export function openDashboardUnavailable(): OpenDashboardResult {
  return { ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE };
}

export function isOpenDashboardResult(value: unknown): value is OpenDashboardResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { ok?: unknown; message?: unknown };
  if (record.ok === true) {
    return !('message' in record);
  }
  return record.ok === false && typeof record.message === 'string' && record.message.length > 0;
}
