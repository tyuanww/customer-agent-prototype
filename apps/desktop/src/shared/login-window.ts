export type LoginAudience = 'feishu' | 'account';

export type LoginChooserState = 'entry' | 'loading' | 'waiting' | 'failed' | 'cancelled';

export type LoginWindowCommandResult =
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'UNAVAILABLE' | 'FAILED' | 'CANCELLED' | 'VALIDATION' };

export type LoginWindowApi = {
  chooseFeishu(): Promise<LoginWindowCommandResult>;
  submitAccount(username: string, password: string): Promise<LoginWindowCommandResult>;
  cancel(): Promise<void>;
};

export function isLoginWindowCommandResult(value: unknown): value is LoginWindowCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return Object.keys(record).length === 1;
  return record.ok === false && typeof record.code === 'string'
    && ['INVALID', 'UNAVAILABLE', 'FAILED', 'CANCELLED', 'VALIDATION'].includes(record.code)
    && Object.keys(record).length === 2;
}
