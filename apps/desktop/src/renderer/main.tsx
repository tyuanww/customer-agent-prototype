import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { installIntakeReviewBridge } from './intake-review-bridge';
import { resolveDashboardTheme, systemPrefersDark } from './lib/dashboard-appearance';
import { readRoleFromLocation } from './lib/window-role';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

try {
  installIntakeReviewBridge();
} catch {
  // A preview fixture must not stop the workbench from painting.
}
const rendererRole = readRoleFromLocation();
document.documentElement.dataset.role = rendererRole;

if (rendererRole === 'dashboard') {
  const resolvedTheme = resolveDashboardTheme('system', systemPrefersDark());
  document.documentElement.dataset.dashboardThemeMode = 'system';
  document.documentElement.dataset.dashboardTheme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
