const OPEN_ID = /^ou_[A-Za-z0-9]{6,64}$/;

export function feishuUserId(openId: string): string {
  return `usr_${openId}`.slice(0, 128);
}

export function isFeishuOpenId(value: string): boolean {
  return OPEN_ID.test(value);
}

/** The open id to admit, or null when the callback must not insert a binding. */
export function feishuAdmitOpenId(reason: string, binding: string | null): string | null {
  if (reason !== 'CAPABILITY_DENIED' || binding === null || !isFeishuOpenId(binding)) return null;
  return binding;
}
