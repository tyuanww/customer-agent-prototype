import { lazy, Suspense } from 'react';
import { DashboardApp } from './DashboardApp';
import { FoxApp } from './FoxApp';
import { QueryApp } from './QueryApp';
import { readRoleFromLocation } from './lib/window-role';
import type { RendererRole } from '@shared/overlay-events';

const LoginApp = lazy(async () => {
  const module = await import('./LoginApp');
  return { default: module.LoginApp };
});

type AppProps = {
  role?: RendererRole;
};

export function App({ role }: AppProps) {
  const resolved = role ?? readRoleFromLocation();
  if (resolved === 'fox') {
    return <FoxApp />;
  }
  if (resolved === 'dashboard') {
    return <DashboardApp />;
  }
  if (resolved === 'login') {
    return (
      <Suspense fallback={null}>
        <LoginApp />
      </Suspense>
    );
  }
  return <QueryApp />;
}
