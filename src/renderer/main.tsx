import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { resolveDashboardTheme } from './lib/dashboard-appearance';
import { readRoleFromLocation } from './lib/window-role';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const rendererRole = readRoleFromLocation();
document.documentElement.dataset.role = rendererRole;

if (rendererRole === 'dashboard') {
  const systemPrefersDark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme = resolveDashboardTheme('system', systemPrefersDark);
  document.documentElement.dataset.dashboardThemeMode = 'system';
  document.documentElement.dataset.dashboardTheme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
