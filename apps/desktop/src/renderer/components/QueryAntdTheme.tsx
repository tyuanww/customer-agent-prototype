import { ConfigProvider, theme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useLayoutEffect, useState, type ReactNode } from 'react';

/** Query CSS owns the palette, including system contrast and transparency preferences. */
function queryTheme(): ThemeConfig {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(name).trim() || undefined;
  const algorithm = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const primary = theme.getDesignToken({ algorithm, token: { colorPrimary: color('--query-primary') } });
  return {
    algorithm,
    token: {
      colorPrimary: color('--fox'), colorText: color('--ink'), colorTextSecondary: color('--muted'),
      colorTextDescription: color('--muted'),
      colorBorder: color('--hairline'), colorSplit: color('--hairline'),
      colorBgContainer: color('--query-glass-inner'), colorBgElevated: color('--query-glass-solid'),
      colorSuccess: color('--success'), colorWarning: color('--warning'), colorError: color('--danger'),
      controlOutline: color('--focus'), fontFamily: color('--font-body'),
      fontSize: 14, controlHeight: 32, borderRadius: 10,
      motion: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    },
    components: {
      Button: {
        colorPrimary: primary.colorPrimary,
        colorPrimaryHover: primary.colorPrimaryHover,
        colorPrimaryActive: primary.colorPrimaryActive,
        defaultHoverColor: color('--ink'), defaultActiveColor: color('--ink'),
        defaultHoverBorderColor: color('--focus'), defaultActiveBorderColor: color('--focus'),
        primaryShadow: 'none',
      },
    },
  };
}

export function QueryAntdTheme({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>({});
  useLayoutEffect(() => {
    const update = () => setConfig(queryTheme());
    const queries = ['(prefers-color-scheme: dark)', '(forced-colors: active)',
      '(prefers-reduced-transparency: reduce)', '(prefers-reduced-motion: reduce)']
      .flatMap(query => window.matchMedia ? [window.matchMedia(query)] : []);
    update();
    queries.forEach(query => query.addEventListener('change', update));
    return () => queries.forEach(query => query.removeEventListener('change', update));
  }, []);
  return <ConfigProvider locale={zhCN} theme={config} button={{ autoInsertSpace: false }} wave={{ disabled: true }}>{children}</ConfigProvider>;
}
