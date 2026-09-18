import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginApp } from '../../src/renderer/LoginApp';

afterEach(() => {
  cleanup();
  delete window.loginWindow;
});

function mountLogin(
  submitAccount?: () => Promise<{ ok: true } | { ok: false; code: 'INVALID' | 'UNAVAILABLE' | 'FAILED' | 'CANCELLED' | 'VALIDATION' }>,
  chooseFeishu?: () => Promise<{ ok: true } | { ok: false; code: 'INVALID' | 'UNAVAILABLE' | 'FAILED' | 'CANCELLED' | 'VALIDATION' }>,
) {
  const api = {
    chooseFeishu: vi.fn(chooseFeishu ?? (async () => ({ ok: true as const }))),
    submitAccount: vi.fn(submitAccount ?? (async () => ({ ok: false as const, code: 'INVALID' as const }))),
    cancel: vi.fn(async () => undefined),
  };
  window.loginWindow = api;
  const view = render(<LoginApp />);
  return { ...api, ...view };
}

describe('LoginApp', () => {
  it('defaults to Feishu and only labels the chooser 飞书 / 账号', () => {
    const { container } = mountLogin();
    expect(screen.getByRole('button', { name: '飞书登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '飞书' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '账号' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('将用浏览器打开飞书登录。')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/内部|外包|将在此窗口打开/);
  });

  it('shows browser-open copy while Feishu login is in flight, then waits in the chooser', async () => {
    let finish!: (value: { ok: true }) => void;
    mountLogin(undefined, () => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '飞书登录' }));
    expect(await screen.findByText('正在打开浏览器…')).toBeInTheDocument();
    finish({ ok: true });
    expect(await screen.findByText('正在等待登录完成。可关闭浏览器页，回到此窗等待。')).toBeInTheDocument();
  });

  it('distinguishes a blocked browser from a rejected authorize URL', async () => {
    const { chooseFeishu } = mountLogin(undefined, async () => ({ ok: false, code: 'UNAVAILABLE' }));
    fireEvent.click(screen.getByRole('button', { name: '飞书登录' }));
    expect(await screen.findByText('无法打开浏览器，请重试。')).toBeInTheDocument();
    chooseFeishu.mockResolvedValueOnce({ ok: false, code: 'VALIDATION' });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('无法开始登录。')).toBeInTheDocument();
  });

  it('submits the account form through the login preload and keeps invalid copy generic', async () => {
    const { submitAccount } = mountLogin();
    fireEvent.click(screen.getByRole('button', { name: '账号' }));
    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), { target: { value: 'synthetic_agent' } });
    fireEvent.change(document.querySelector('input[name="password"]') as HTMLInputElement, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(submitAccount).toHaveBeenCalledWith('synthetic_agent', 'nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确，请重试。');
    expect(screen.queryByText('正在打开浏览器…')).not.toBeInTheDocument();
  });

  it('shows account busy copy while the password check is in flight', async () => {
    let finish!: (value: { ok: false; code: 'INVALID' }) => void;
    mountLogin(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '账号' }));
    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), { target: { value: 'synthetic_agent' } });
    fireEvent.change(document.querySelector('input[name="password"]') as HTMLInputElement, { target: { value: 'synthetic-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('正在验证账号…')).toBeInTheDocument();
    finish({ ok: false, code: 'INVALID' });
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确，请重试。');
  });

  it('cancels from Escape', () => {
    const { cancel } = mountLogin();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cancel).toHaveBeenCalled();
  });
});
