import { DashboardApp } from './DashboardApp';
import { FoxApp } from './FoxApp';
import { QueryApp } from './QueryApp';
import { readRoleFromLocation } from './lib/window-role';
import type { RendererRole } from '@shared/overlay-events';

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
  return <QueryApp />;
}
