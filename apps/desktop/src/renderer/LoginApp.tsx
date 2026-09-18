import { useEffect, useState } from 'react';
import { FoxHead } from './components/FoxHead';
import type { LoginAudience, LoginChooserState } from '@shared/login-window';
import './styles/login.css';

function readChooserState(search = window.location.search): LoginChooserState {
  const value = new URLSearchParams(search).get('loginState');
  return value === 'loading' || value === 'waiting' || value === 'failed' || value === 'cancelled' ? value : 'entry';
}

export function LoginApp() {
  const [audience, setAudience] = useState<LoginAudience>('feishu');
  const [state, setState] = useState<LoginChooserState>(readChooserState);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [failKind, setFailKind] = useState<'start' | 'open' | null>(null);
  const busy = state === 'loading' || state === 'waiting';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.loginWindow?.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chooseFeishu = async () => {
    setState('loading');
    setInvalid(false);
    setFailKind(null);
    const result = await window.loginWindow!.chooseFeishu();
    if (result.ok) { setState('waiting'); return; }
    if (result.code === 'CANCELLED') { setState('cancelled'); return; }
    if (result.code === 'UNAVAILABLE') { setFailKind('open'); setState('failed'); return; }
    setFailKind('start');
    setState('failed');
  };

  const submitAccount = async () => {
    setInvalid(false);
    setAccountUnavailable(false);
    setState('loading');
    const result = await window.loginWindow!.submitAccount(username, password);
    if (result.ok) return;
    if (result.code === 'INVALID') { setInvalid(true); setState('entry'); return; }
    if (result.code === 'UNAVAILABLE') { setAccountUnavailable(true); setState('entry'); return; }
    if (result.code === 'FAILED' || result.code === 'VALIDATION') { setFailKind('start'); setState('failed'); return; }
    if (result.code === 'CANCELLED') setState('cancelled');
  };

  const failedCopy = failKind === 'start' ? '无法开始登录。' : '无法打开浏览器，请重试。';

  return (
    <div className="login-window">
      <header className="login-header">
        <FoxHead size={40} />
        <div className="login-titles">
          <h1 className="login-title">登录</h1>
          <p className="login-subtitle">身份验证后返回查询</p>
        </div>
      </header>

      {state === 'loading' ? (
        <>
          <p className="login-copy">{audience === 'account' ? '正在验证账号…' : '正在打开浏览器…'}</p>
          <div className="login-actions">
            <button type="button" className="login-cancel" onClick={() => void window.loginWindow?.cancel()}>取消</button>
          </div>
        </>
      ) : state === 'waiting' ? (
        <>
          <p className="login-copy">正在等待登录完成。可关闭浏览器页，回到此窗等待。</p>
          <div className="login-actions">
            <button type="button" className="login-cancel" onClick={() => void window.loginWindow?.cancel()}>取消</button>
          </div>
        </>
      ) : state === 'failed' ? (
        <>
          <p className="login-copy" style={{ color: 'var(--danger)' }}>{failedCopy}</p>
          <div className="login-actions">
            <button type="button" className="login-primary" onClick={() => void chooseFeishu()}>重试</button>
            <button type="button" className="login-cancel" onClick={() => void window.loginWindow?.cancel()}>取消</button>
          </div>
        </>
      ) : state === 'cancelled' ? (
        <>
          <p className="login-copy">已取消登录。</p>
          <div className="login-actions">
            <button type="button" className="login-primary" autoFocus onClick={() => { setState('entry'); setAudience('feishu'); setFailKind(null); }}>重新登录</button>
          </div>
        </>
      ) : (
        <>
          <div className="login-audience" role="group" aria-label="登录方式">
            <button type="button" className="login-segment" aria-pressed={audience === 'feishu'} disabled={busy}
              onClick={() => { setAudience('feishu'); setInvalid(false); }}>飞书</button>
            <button type="button" className="login-segment" aria-pressed={audience === 'account'} disabled={busy}
              onClick={() => { setAudience('account'); setInvalid(false); }}>账号</button>
          </div>
          {audience === 'feishu' ? (
            <>
              <p className="login-copy">将用浏览器打开飞书登录。</p>
              <div className="login-actions">
                <button type="button" className="login-primary" autoFocus disabled={busy} onClick={() => void chooseFeishu()}>飞书登录</button>
                <button type="button" className="login-cancel" disabled={busy} onClick={() => void window.loginWindow?.cancel()}>取消</button>
              </div>
            </>
          ) : (
            <form className="login-form" onSubmit={(event) => { event.preventDefault(); void submitAccount(); }}>
              <p className="login-copy">使用管理员下发的账号登录。</p>
              {invalid ? <p className="login-error" role="alert">账号或密码不正确，请重试。</p> : null}
              {accountUnavailable ? <p className="login-error" role="alert">账号登录暂时不可用，请改用飞书或联系管理员。</p> : null}
              <label className="login-field">
                <span>账号</span>
                <input name="username" autoComplete="username" value={username} disabled={busy}
                  onChange={(event) => { setUsername(event.target.value); setInvalid(false); }} />
              </label>
              <label className="login-field">
                <span>密码</span>
                <input name="password" type="password" autoComplete="current-password" value={password} disabled={busy}
                  onChange={(event) => { setPassword(event.target.value); setInvalid(false); }} />
              </label>
              <div className="login-actions">
                <button type="submit" className="login-primary" disabled={busy}>登录</button>
                <button type="button" className="login-cancel" disabled={busy} onClick={() => void window.loginWindow?.cancel()}>取消</button>
              </div>
              <p className="login-hint">没有账号或忘记密码？请联系管理员。</p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
