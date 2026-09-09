/** Public session projection. Credentials never cross preload. Epoch is owned by main. */
export type ProductSessionView = {
  ok: true; enabled: boolean; signedIn: boolean; sessionEpoch: number;
  userId: string | null; role: 'agent' | 'coach' | 'owner' | null;
  authMode: 'mock' | 'feishu' | null; expiresAt: string | null;
};
export const PRODUCT_ERRORS = {
  UNAUTHORIZED: '请先登录，或重新登录后继续', VALIDATION: '请求内容无效',
  FORBIDDEN: '当前身份不能执行此操作', GONE: '登录请求已过期，请重试',
  CONFLICT: '操作已在进行或已完成', UNAVAILABLE: '服务暂不可用，请重试',
  OVERLOADED: '服务繁忙，请稍后重试', RATE_LIMITED: '操作过于频繁，请稍后重试',
  CANCELLED: '操作已取消', STALE: '内容已变化，请重新查询',
  CLIPBOARD_FAILED: '复制失败，请重试', SOURCE_GATE_NOT_READY: '内容暂不可用，请联系话术师核实',
} as const;
export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;
export type ProductFailure = { ok: false; sessionEpoch: number; code: ProductErrorCode; message: string };
export type ProductSessionResult = ProductSessionView | ProductFailure;
export function productFailure(code: ProductErrorCode, sessionEpoch = 0): ProductFailure {
  return { ok: false, code, sessionEpoch, message: PRODUCT_ERRORS[code] };
}
export function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function isProductSessionResult(value: unknown): value is ProductSessionResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.sessionEpoch) || (v.sessionEpoch as number) < 0) return false;
  if (v.ok === false) return exactKeys(v, ['ok', 'code', 'sessionEpoch', 'message'])
    && typeof v.code === 'string' && Object.hasOwn(PRODUCT_ERRORS, v.code)
    && v.message === PRODUCT_ERRORS[v.code as ProductErrorCode];
  if (!exactKeys(v, ['ok', 'enabled', 'signedIn', 'sessionEpoch', 'userId', 'role', 'authMode', 'expiresAt'])
    || v.ok !== true || typeof v.enabled !== 'boolean' || typeof v.signedIn !== 'boolean') return false;
  if (!v.signedIn) return v.userId === null && v.role === null && v.authMode === null && v.expiresAt === null;
  return v.enabled && typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= 128
    && ['agent', 'coach', 'owner'].includes(v.role as string)
    && ['mock', 'feishu'].includes(v.authMode as string)
    && typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt));
}
export type ProductSessionApi = {
  sessionStatus(): Promise<ProductSessionResult>;
  login(): Promise<ProductSessionResult>;
  logout(): Promise<ProductSessionResult>;
  onSessionChanged(listener: (value: ProductSessionResult) => void): () => void;
};
