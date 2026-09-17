import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginApp } from '../../src/renderer/LoginApp';

afterEach(() => {
  cleanup();
  delete window.loginWindow;
});

describe('LoginApp', () => {
  it('defaults to Feishu and submits the account form through the login preload', async () => {
    const submitAccount = vi.fn(async () => ({ ok: false, code: 'INVALID' as const }));
    window.loginWindow = {
      chooseFeishu: vi.fn(async () => ({ ok: true as const })),
      submitAccount,
      cancel: vi.fn(async () => undefined),
    };
    render(<LoginApp />);
    expect(screen.getByRole('button', { name: '飞书登录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '账号' }));
    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), { target: { value: 'synthetic_agent' } });
    fireEvent.change(document.querySelector('input[name="password"]') as HTMLInputElement, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(submitAccount).toHaveBeenCalledWith('synthetic_agent', 'nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确，请重试。');
  });
});
