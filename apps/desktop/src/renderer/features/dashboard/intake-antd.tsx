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

/** Radix UI Colors v3 steps, mirrored from styles/radix-palette.css. antd needs literal
 *  colours to derive its own hover and active states, so these are the one place the
 *  palette appears outside that file. `workbench-theme.test.ts` keeps the two in step. */
export const RADIX = Object.freeze({
  light: {
    mauve1: '#fdfcfd', mauve2: '#faf9fb', mauve3: '#f2eff3', mauve6: '#dbd8e0', mauve7: '#d0cdd7',
    mauve9: '#8e8c99', mauve11: '#65636d', mauve12: '#211f26',
    violet3: '#f4f0fe', violet9: '#6e56cf', violet11: '#6550b9',
    grass11: '#2a7e3b', amber3: '#fff7c2', amber6: '#f3d673', amber11: '#ab6400',
    tomato3: '#feebe7', tomato6: '#fdbdaf', tomato9: '#e54d2e', tomato11: '#d13415',
  },
  dark: {
    mauve1: '#121113', mauve2: '#1a191b', mauve3: '#232225', mauve6: '#3c393f', mauve7: '#49474e',
    mauve9: '#6f6d78', mauve11: '#b5b2bc', mauve12: '#eeeef0',
    violet3: '#291f43', violet9: '#6e56cf', violet11: '#baa7ff',
    grass11: '#71d083', amber3: '#302008', amber6: '#5c3d05', amber11: '#ffca16',
    tomato3: '#391714', tomato6: '#6e2920', tomato9: '#e54d2e', tomato11: '#ff977d',
  },
});

export function IntakeAntdTheme({ children }: { children: ReactNode }) {
  const c = RADIX[useDashboardMode()];
  const dark = c === RADIX.dark;
  return <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} wave={{ disabled: true }} theme={{
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.violet9,
      colorInfo: c.violet9,
      colorSuccess: c.grass11,
      colorWarning: c.amber11,
      colorError: c.tomato11,
      colorText: c.mauve12,
      colorTextSecondary: c.mauve11,
      colorTextTertiary: c.mauve9,
      colorTextDescription: c.mauve11,
      colorTextPlaceholder: c.mauve9,
      colorLink: c.violet11,
      colorBorder: c.mauve7,
      colorBorderSecondary: c.mauve6,
      colorSplit: c.mauve6,
      colorBgLayout: c.mauve1,
      colorBgContainer: c.mauve1,
      colorBgElevated: c.mauve1,
      colorFillAlter: c.mauve2,
      colorFillTertiary: c.mauve3,
      colorWarningBg: c.amber3,
      colorWarningBorder: c.amber6,
      colorErrorBg: c.tomato3,
      colorErrorBorder: c.tomato6,
      borderRadius: 6,
      borderRadiusLG: 10,
      borderRadiusSM: 4,
      lineWidth: 0.5,
      fontFamily: DASHBOARD_FONT_FAMILY,
      fontSize: 14,
      fontSizeSM: 12,
      fontSizeLG: 14,
      fontSizeHeading1: 20,
      fontSizeHeading2: 20,
      fontSizeHeading3: 20,
      fontSizeHeading4: 14,
      fontSizeHeading5: 14,
      controlHeight: 32,
      motionDurationFast: '0.2s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.2s',
      motionEaseOut: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      boxShadow: 'none',
      boxShadowSecondary: `0 8px 24px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(33,31,38,0.10)'}`,
      boxShadowTertiary: 'none',
    },
    components: {
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        fontWeight: 500,
        defaultBg: c.mauve1,
        defaultColor: c.mauve12,
        defaultBorderColor: c.mauve7,
      },
      Table: {
        headerBg: 'transparent',
        headerColor: c.mauve11,
        headerSplitColor: 'transparent',
        borderColor: c.mauve6,
        rowHoverBg: c.mauve2,
        cellFontSize: 14,
        cellPaddingBlock: 12,
        cellPaddingInline: 12,
      },
      Tabs: { inkBarColor: c.violet9, itemSelectedColor: c.mauve12, itemColor: c.mauve11, itemHoverColor: c.mauve12 },
      Modal: { titleFontSize: 14 },
      Tag: { defaultBg: c.mauve2 },
    },
  }}>{children}</ConfigProvider>;
}
