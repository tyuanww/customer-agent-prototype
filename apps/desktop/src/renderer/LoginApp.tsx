import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { FoxHead } from './components/FoxHead';
import type { LoginAudience, LoginChooserState } from '@shared/login-window';
import { IntakeAntdTheme } from './features/dashboard/intake-antd';
import './styles/radix-palette.css';
import './styles/workbench-tokens.css';
import './styles/login.css';

function readChooserState(search = window.location.search): LoginChooserState {
  const value = new URLSearchParams(search).get('loginState');
  return value === 'loading' || value === 'waiting' || value === 'failed' || value === 'cancelled' ? value : 'entry';
}

/** The login window: a native-titled system window with the workbench look. It chooses between
 *  Feishu (opens the system browser) and an administrator-issued account. Success is the session
 *  exchange, owned by the login preload; this view only reflects it. */
export function LoginApp() {
  const [audience, setAudience] = useState<LoginAudience>('feishu');
  const [state, setState] = useState<LoginChooserState>(readChooserState);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [failKind, setFailKind] = useState<'start' | 'open' | null>(null);
  const busy = state === 'loading' || state === 'waiting';
  const cancel = () => void window.loginWindow?.cancel();

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

  let body;
  if (state === 'loading') {
    body = <>
      <p className="login-copy">{audience === 'account' ? '正在验证账号…' : '正在打开浏览器…'}</p>
      <div className="login-actions"><Button onClick={cancel}>取消</Button></div>
    </>;
  } else if (state === 'waiting') {
    body = <>
      <p className="login-copy">正在等待登录完成。如果浏览器里没有点授权，回到查询窗口再点一次登录。</p>
      <div className="login-actions"><Button onClick={cancel}>取消</Button></div>
    </>;
  } else if (state === 'failed') {
    body = <>
      <p className="login-copy is-error" role="alert">{failedCopy}</p>
      <div className="login-actions">
        <Button type="primary" onClick={() => void chooseFeishu()}>重试</Button>
        <Button onClick={cancel}>取消</Button>
      </div>
    </>;
  } else if (state === 'cancelled') {
    body = <>
      <p className="login-copy">已取消登录。</p>
      <div className="login-actions">
        <Button type="primary" autoFocus onClick={() => { setState('entry'); setAudience('feishu'); setFailKind(null); }}>重新登录</Button>
      </div>
    </>;
  } else {
    body = <>
      <div className="login-segmented" role="group" aria-label="登录方式">
        {/* A two-option toggle with an aria-pressed contract; styled to match antd. */}
        {(['feishu', 'account'] as const).map((value) => <button // eslint-disable-line no-restricted-syntax
          key={value}
          type="button"
          className="login-segment"
          aria-pressed={audience === value}
          disabled={busy}
          onClick={() => { setAudience(value); setInvalid(false); }}
        >{value === 'feishu' ? '飞书' : '账号'}</button>)}
      </div>
      {audience === 'feishu' ? <>
        <p className="login-copy">将用浏览器打开飞书登录。</p>
        <div className="login-actions">
          <Button type="primary" autoFocus disabled={busy} onClick={() => void chooseFeishu()}>飞书登录</Button>
          <Button disabled={busy} onClick={cancel}>取消</Button>
        </div>
      </> : (
        <Form layout="vertical" requiredMark={false} component={false}>
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); void submitAccount(); }}>
          {invalid ? <Alert type="error" showIcon={false} role="alert" message="账号或密码不正确，请重试。" /> : null}
          {accountUnavailable ? <Alert type="error" showIcon={false} role="alert" message="账号登录暂时不可用，请改用飞书或联系管理员。" /> : null}
          <Form.Item label="账号" htmlFor="login-username">
            <Input id="login-username" name="username" autoComplete="username" value={username} disabled={busy}
              onChange={(event) => { setUsername(event.target.value); setInvalid(false); }} />
          </Form.Item>
          <Form.Item label="密码" htmlFor="login-password">
            <Input.Password id="login-password" name="password" autoComplete="current-password" value={password} disabled={busy}
              visibilityToggle={false}
              onChange={(event) => { setPassword(event.target.value); setInvalid(false); }} />
          </Form.Item>
          <div className="login-actions">
            <Button type="primary" htmlType="submit" disabled={busy}>登录</Button>
            <Button disabled={busy} onClick={cancel}>取消</Button>
          </div>
          <p className="login-hint">没有账号或忘记密码？请联系管理员。</p>
          </form>
        </Form>
      )}
    </>;
  }

  return (
    <IntakeAntdTheme>
      <div className="login-window">
        <header className="login-header">
          <FoxHead size={32} />
          <h1 className="login-title">登录</h1>
        </header>
        {body}
      </div>
    </IntakeAntdTheme>
  );
}
