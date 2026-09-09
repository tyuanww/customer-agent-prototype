import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { exactKeys, productFailure, type ProductSessionResult, type ProductSessionView } from '../shared/product-session';
import { ProductHttp, ProductHttpError } from './product-http';

type StoredSession = { access_token: string; expires_at: string };
export type SessionStore = { read(): unknown; write(value: StoredSession): void; clear(): void };
export type LoginWindow = { open(url: string, signal: AbortSignal): Promise<void> };
function validSession(v: unknown): v is StoredSession {
  return exactKeys(v, ['access_token', 'expires_at']) && typeof v.access_token === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(v.access_token) && typeof v.expires_at === 'string' && Number.isFinite(Date.parse(v.expires_at));
}
/** Owns credential lifetime and epoch. Sync store operations cannot race with logout. */
export class ProductSession {
  private epoch = 0;
  private token: StoredSession | null = null;
  private user: { userId: string; role: 'agent' | 'coach' | 'owner'; authMode: 'mock' | 'feishu' } | null = null;
  private operation: AbortController | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: ProductSessionResult) => void>();
  constructor(readonly http: ProductHttp, private readonly store: SessionStore, private readonly window: LoginWindow) {}
  subscribe(listener: (state: ProductSessionResult) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(state: ProductSessionResult) { for (const listener of this.listeners) listener(state); }
  view(): ProductSessionView {
    if (this.token && Date.parse(this.token.expires_at) <= Date.now()) this.invalidate();
    return { ok: true, enabled: true, signedIn: !!this.token && !!this.user, sessionEpoch: this.epoch,
      userId: this.user?.userId ?? null, role: this.user?.role ?? null, authMode: this.user?.authMode ?? null,
      expiresAt: this.token?.expires_at ?? null };
  }
  private invalidate() {
    this.epoch++; this.operation?.abort(); this.operation = null; this.token = null; this.user = null;
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
    let state: ProductSessionResult;
    try { this.store.clear(); state = this.view(); } catch { state = productFailure('UNAVAILABLE', this.epoch); }
    this.emit(state); return state;
  }
  private async identify(token: StoredSession, signal: AbortSignal) {
    const { value } = await this.http.request('/v1/auth/me', { token: token.access_token, signal });
    if (!exactKeys(value, ['user_id', 'role', 'auth_mode']) || typeof value.user_id !== 'string'
      || value.user_id.length < 1 || value.user_id.length > 128
      || !['agent', 'coach', 'owner'].includes(value.role as string) || value.auth_mode !== 'mock') throw new ProductHttpError('UNAUTHORIZED');
    return { userId: value.user_id, role: value.role as 'agent' | 'coach' | 'owner', authMode: value.auth_mode as 'mock' };
  }
  private install(token: StoredSession, user: NonNullable<ProductSession['user']>, epoch: number, signal: AbortSignal) {
    if (signal.aborted || epoch !== this.epoch) throw new ProductHttpError('STALE');
    const remaining = Date.parse(token.expires_at) - Date.now();
    if (remaining <= 0 || remaining > 15 * 60_000) throw new ProductHttpError('UNAUTHORIZED');
    this.store.write(token); this.epoch++; this.token = token; this.user = user;
    this.expiry = setTimeout(() => this.invalidate(), remaining); this.expiry.unref?.();
    const state = this.view(); this.emit(state); return state;
  }
  private fail(error: unknown, epoch: number) {
    if (epoch !== this.epoch) return productFailure('STALE', epoch);
    this.invalidate();
    return productFailure(error instanceof ProductHttpError ? error.code : 'UNAVAILABLE', this.epoch);
  }
  async restore(): Promise<ProductSessionResult> {
    const epoch = this.epoch; const operation = new AbortController(); this.operation = operation;
    try {
      const stored = this.store.read(); if (stored === null) return this.view();
      if (!validSession(stored)) throw new ProductHttpError('UNAUTHORIZED');
      return this.install(stored, await this.identify(stored, operation.signal), epoch, operation.signal);
    } catch (error) { return this.fail(error, epoch); }
    finally { if (this.operation === operation) this.operation = null; }
  }
  async status(): Promise<ProductSessionResult> {
    if (!this.view().signedIn || !this.token) return this.view();
    const epoch = this.epoch; const token = this.token;
    try {
      const user = await this.identify(token, AbortSignal.timeout(5_000));
      if (epoch !== this.epoch || token !== this.token) return productFailure('STALE', epoch);
      if (user.role !== this.user?.role || user.userId !== this.user?.userId) {
        this.epoch++; this.user = user; this.emit(this.view());
      }
      return this.view();
    } catch (error) { return this.fail(error, epoch); }
  }
  async login(): Promise<ProductSessionResult> {
    if (this.operation) return productFailure('CONFLICT', this.epoch);
    if (this.token) return this.status();
    const cleared = this.invalidate(); if (!cleared.ok) return cleared;
    const epoch = this.epoch; const operation = new AbortController(); this.operation = operation;
    const deadline = setTimeout(() => operation.abort(), 120_000);
    let exchangedToken: string | undefined;
    try {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const { value: created } = await this.http.request('/v1/auth/login-requests', { body: { client_challenge: challenge }, signal: operation.signal });
      if (!exactKeys(created, ['login_id', 'authorize_url', 'expires_at']) || typeof created.login_id !== 'string'
        || !/^login_[A-Za-z0-9_-]{43}$/.test(created.login_id) || typeof created.authorize_url !== 'string') throw new ProductHttpError('VALIDATION');
      await this.window.open(created.authorize_url, operation.signal);
      for (;;) {
        const result = await this.http.request(`/v1/auth/login-requests/${created.login_id}/exchange`, { body: { client_verifier: verifier }, signal: operation.signal });
        if (result.status === 202) { await delay(2_000, undefined, { signal: operation.signal }); continue; }
        const v = result.value;
        if (!exactKeys(v, ['access_token', 'token_type', 'expires_at']) || v.token_type !== 'Bearer') throw new ProductHttpError('VALIDATION');
        const token = { access_token: v.access_token, expires_at: v.expires_at };
        if (!validSession(token)) throw new ProductHttpError('VALIDATION');
        exchangedToken = token.access_token;
        return this.install(token, await this.identify(token, operation.signal), epoch, operation.signal);
      }
    } catch (error) {
      const failure = this.fail(error, epoch);
      if (exchangedToken) {
        try { await this.http.request('/v1/auth/logout', { token: exchangedToken, method: 'POST' }); }
        catch { /* Local state is already blocked; remote token expires within 15 minutes. */ }
      }
      return failure;
    }
    finally { clearTimeout(deadline); operation.abort(); if (this.operation === operation) this.operation = null; }
  }
  async logout(): Promise<ProductSessionResult> {
    const token = this.token?.access_token; const local = this.invalidate();
    if (token) {
      try { await this.http.request('/v1/auth/logout', { token, method: 'POST' }); }
      catch { return productFailure('UNAVAILABLE', local.sessionEpoch); }
    }
    return local;
  }
  /** Synchronous local clear before Electron tears down; remote revoke is bounded. */
  shutdown() { return this.logout(); }
}
