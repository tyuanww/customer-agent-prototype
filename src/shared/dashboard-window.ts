export const DASHBOARD_WINDOW_TITLE = '客服运营工作台 · 演示数据';

export const DASHBOARD_WINDOW_CHROME = {
  width: 1180,
  height: 760,
  minWidth: 980,
  minHeight: 680,
  frame: true,
  transparent: false,
  backgroundColor: '#F7F6F9',
  hasShadow: true,
  show: false,
  resizable: true,
  minimizable: true,
  maximizable: true,
  fullscreenable: true,
  skipTaskbar: false,
  alwaysOnTop: false,
  autoHideMenuBar: true,
} as const;

export const DASHBOARD_WINDOW_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
} as const;

export const DASHBOARD_ENV_BADGES = ['演示数据'] as const;

export const DASHBOARD_STRUCTURE_DISCLAIMER =
  '无后端 · 不保存 · 话术正文与 VOC 明细均为合成镜像';
export const DASHBOARD_ARCHITECTURE_MARK = '架构模拟 / MOCK / NOT CONNECTED';
export const DASHBOARD_REFRESHED_AT = '2026-08-13 18:40:00 CST';
export const DASHBOARD_REFRESH_LABEL = `数据更新至：${DASHBOARD_REFRESHED_AT} · 固定快照`;
export const DASHBOARD_METRIC_SCOPE =
  '口径：根问题与检索操作双账；adopted = 复制成功，不等于发送或正确。固定合成演示口径，非生产指标。';
