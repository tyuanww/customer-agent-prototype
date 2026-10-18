import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useState, type ReactNode } from 'react';

export const DASHBOARD_FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", sans-serif';

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function readMode(): 'light' | 'dark' {
  const shell = document.querySelector('[data-testid="dashboard-shell"]');
  const value = shell?.getAttribute('data-theme') ?? document.documentElement.getAttribute('data-dashboard-theme');
  return value === 'dark' ? 'dark' : 'light';
}

function useDashboardMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(readMode);
  useEffect(() => {
    const sync = () => setMode(readMode());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dashboard-theme'] });
    const shell = document.querySelector('[data-testid="dashboard-shell"]');
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** Ant Design skin for the whole workbench. Font, ink, radius, control height,
 * and table density live here. Pages replace their own selects as they move. */
export function IntakeAntdTheme({ children }: { children: ReactNode }) {
  const dark = useDashboardMode() === 'dark';
  return <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#6f4cc3',
      colorInfo: dark ? '#a78bfa' : '#6f4cc3',
      colorSuccess: dark ? '#63c6a4' : '#1f7a5a',
      colorWarning: dark ? '#e2b465' : '#97620b',
      colorError: dark ? '#f28b8b' : '#b84040',
      colorText: dark ? '#f5f3f7' : '#24212a',
      colorTextSecondary: dark ? '#d4d0dc' : '#6e6878',
      colorTextDescription: dark ? '#d4d0dc' : '#6e6878',
      colorLink: dark ? '#c4b5fd' : '#6f4cc3',
      colorBorder: dark ? '#8f8798' : '#8e8797',
      colorBgContainer: dark ? '#1c1b20' : '#ffffff',
      colorBgElevated: dark ? '#1c1b20' : '#ffffff',
      colorWarningBg: dark ? '#2c261c' : '#fbf8f1',
      colorWarningBorder: dark ? '#6a5430' : '#e4d3ae',
      colorErrorBg: dark ? '#351f25' : '#fbf1f1',
      colorErrorBorder: dark ? '#68404a' : '#e5c7c7',
      borderRadius: 8,
      fontFamily: DASHBOARD_FONT_FAMILY,
      fontSize: 14,
      controlHeight: 38,
      motion: false,
      boxShadow: 'none',
      boxShadowSecondary: 'none',
      boxShadowTertiary: 'none',
    },
    components: {
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        fontWeight: 600,
        defaultBg: dark ? '#1c1b20' : '#ffffff',
        defaultColor: dark ? '#f5f3f7' : '#24212a',
        defaultBorderColor: dark ? '#8f8798' : '#8e8797',
      },
      Table: {
        headerBg: 'transparent',
        headerColor: dark ? '#aaa4b1' : '#6b6878',
        headerSplitColor: dark ? '#2e2c36' : '#ecebf1',
        borderColor: dark ? '#2e2c36' : '#ecebf1',
        cellPaddingBlock: 12,
        cellPaddingInline: 12,
      },
    },
  }}>{children}</ConfigProvider>;
}
