import { lazy, Suspense, useEffect, useState } from 'react';
import { DashboardApp } from './DashboardApp';
import { FoxApp } from './FoxApp';
import { QueryApp } from './QueryApp';
import { readRoleFromLocation } from './lib/window-role';
import type { RendererRole } from '@shared/overlay-events';

const LoginApp = lazy(async () => {
  const module = await import('./LoginApp');
  return { default: module.LoginApp };
});

const SopApp = lazy(async () => {
  const module = await import('./SopApp');
  return { default: module.SopApp };
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
  if (resolved === 'sop') {
    return (
      <Suspense fallback={null}>
        <SopApp />
      </Suspense>
    );
  }
  return <QueryEntry />;
}

/** Resolve Main's profile before mounting query effects; a failed handshake must
 * never fall back to fixture search or activate the legacy network path. */
function QueryEntry() {
  const [mode, setMode] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let alive = true;
    const api = window.customerAgent?.intakeQuery;
    if (!api) { setMode(false); return; }
    setError(false);
    void api.mode().then(result => {
      if (!alive) return;
      if (result.ok) setMode(result.enabled); else setError(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [attempt]);
  if (mode !== null) return <QueryApp intake={mode} />;
  return <div role="status">{error ? <>查询入口暂不可用 <button onClick={() => retry(x => x + 1)}>重试</button></> : '正在准备查询…'}</div>;
}
