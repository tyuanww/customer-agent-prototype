import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { parseContractSchema } from '@customer-agent/contracts';
import type { DashboardSopNode } from '../shared/dashboard-ops-loop';
import {
  grantUse,
  openGrantBrand,
  withPermissionsBody,
  type OpenGrant,
  type PageUseSnapshot,
  type PermissionsUse,
  type SopUse,
} from '../shared/page-use';
import type { SeatAccountRecord } from '../shared/seat-account-intent';
import type { ContentIntakePermissions } from './content-intake-permissions';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { isTrustedMainFrameSender } from './sender-guard';

export const PAGE_USE_CURRENT_CHANNEL = 'dashboard:page-use-current';
export const PAGE_USE_CHANGED_CHANNEL = 'dashboard:page-use-changed';

export type CatalogOutcome =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unavailable' };

export type SeatList = { readonly seats: readonly SeatAccountRecord[] };

export function sopUseFromCatalog(outcome: CatalogOutcome): Exclude<SopUse, { state: 'pending' }> {
  if (outcome.kind === 'forbidden' || outcome.kind === 'unauthorized') return { state: 'closed' };
  if (outcome.kind !== 'ok') return { state: 'unavailable' };
  try {
    const parsed = parseContractSchema('SopCatalogResponse', outcome.value);
    const nodes: DashboardSopNode[] = parsed.items.map((item) => ({
      nodeId: item.node_id,
      parentNodeId: item.parent_node_id,
      title: item.title,
      body: item.body,
      sortKey: item.sort_key,
      version: item.version,
      lifecycle: item.lifecycle,
    }));
    return { state: 'open', nodes };
  } catch {
    return { state: 'unavailable' };
  }
}

type AuthorizationRead =
  | { readonly ok: true; readonly capabilities: readonly { readonly mayAllocate: readonly string[] }[] }
  | { readonly ok: false; readonly failure: 'unauthorized' | 'forbidden' | 'unavailable' | 'stale' };

function catalogOutcomeFromError(error: unknown): CatalogOutcome {
  if (!(error instanceof ProductHttpError)) return { kind: 'unavailable' };
  if (error.code === 'FORBIDDEN') return { kind: 'forbidden' };
  if (error.code === 'UNAUTHORIZED') return { kind: 'unauthorized' };
  return { kind: 'unavailable' };
}

function isOpenGrant(value: OpenGrant | PermissionsUse): value is OpenGrant {
  return value.state === 'open' && openGrantBrand in value;
}

function seatRow(value: unknown): SeatAccountRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.displayName !== 'string' || typeof row.username !== 'string'
    || typeof row.post !== 'string' || typeof row.enabled !== 'boolean') return null;
  return {
    displayName: row.displayName,
    username: row.username,
    post: row.post as SeatAccountRecord['post'],
    enabled: row.enabled,
  };
}

export class PageUseReader {
  private snapshot: PageUseSnapshot = { phase: 'signed-out' };
  private openGate: OpenGrant | null = null;
  private listsReady = false;
  private suppress = 0;
  private permissionGeneration = 0;
  private sopGeneration = 0;
  private readonly listeners = new Set<(snapshot: PageUseSnapshot) => void>();
  private readonly stopSession: () => void;
  private readonly stopPermissions: () => void;

  constructor(
    private readonly session: ProductSession,
    private readonly permissions: ContentIntakePermissions,
  ) {
    this.stopSession = session.subscribe(() => this.onSession());
    this.stopPermissions = permissions.subscribe(() => this.onPermissions());
    this.onSession();
  }

  current(): PageUseSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: PageUseSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.stopSession();
    this.stopPermissions();
    this.listeners.clear();
    this.permissions.dispose();
  }

  async warmPermissions(epoch: number): Promise<PermissionsUse> {
    const id = ++this.permissionGeneration;
    const opened = this.applyAuthorization(id, epoch, await this.readAuthorization(epoch));
    if (isOpenGrant(opened)) return { state: 'open', body: null };
    return opened;
  }

  async refreshPermissions(epoch: number): Promise<PermissionsUse> {
    const id = ++this.permissionGeneration;
    const first = await this.readAuthorization(epoch);
    const opened = this.applyAuthorization(id, epoch, first);
    if (!this.permissionCurrent(id, epoch)) return this.droppedPermissions();
    if (!isOpenGrant(opened)) return opened;
    this.suppress += 1;
    try {
      const body = await this.permissions.loadLists(opened, epoch);
      if (!this.permissionCurrent(id, epoch)) return this.abandonStale(id);
      const second = await this.readAuthorization(epoch);
      if (!this.permissionCurrent(id, epoch)) return this.abandonStale(id);
      const still = this.applyAuthorization(id, epoch, second);
      if (!isOpenGrant(still)) {
        this.permissions.dropLists();
        this.listsReady = false;
        this.openGate = null;
        return still;
      }
      this.openGate = still;
      this.listsReady = true;
      const next = withPermissionsBody(still, body);
      this.commitPermissions(epoch, next);
      return next;
    } catch {
      if (!this.permissionCurrent(id, epoch)) return this.abandonStale(id);
      this.permissions.dropLists();
      this.listsReady = false;
      this.openGate = null;
      const unavailable: PermissionsUse = { state: 'unavailable' };
      this.commitPermissions(epoch, unavailable);
      return unavailable;
    } finally {
      this.suppress -= 1;
    }
  }

  async openSop(epoch: number): Promise<SopUse> {
    const id = ++this.sopGeneration;
    if (!this.sameEpoch(epoch)) return this.dropSop();
    let outcome: CatalogOutcome;
    try {
      const result = await this.session.request(epoch, '/v1/sop/catalog', { maxResponseBytes: 1_048_576 });
      outcome = { kind: 'ok', value: result.value };
    } catch (error) {
      outcome = catalogOutcomeFromError(error);
    }
    if (id !== this.sopGeneration || !this.sameEpoch(epoch)) return this.dropSop();
    if (outcome.kind === 'unauthorized') {
      this.becomeSignedOut();
      return { state: 'closed' };
    }
    const next = sopUseFromCatalog(outcome);
    this.commitSop(epoch, next);
    return next;
  }

  async afterSopWrite(epoch: number, result: { ok: true } | { ok: false; code: string }): Promise<void> {
    if (!this.sameEpoch(epoch)) return;
    if (result.ok) {
      await this.openSop(epoch);
      return;
    }
    if (result.code === 'FORBIDDEN') {
      this.commitSop(epoch, { state: 'closed' });
      return;
    }
    if (result.code === 'UNAVAILABLE' || result.code === 'OVERLOADED' || result.code === 'RATE_LIMITED') {
      this.commitSop(epoch, { state: 'unavailable' });
    }
  }

  async listSeats(epoch: number): Promise<SeatList | { readonly state: 'closed' }> {
    if (!this.permissionsAreOpen(epoch)) return { state: 'closed' };
    const result = await this.session.request(epoch, '/v1/intake/seats', { method: 'GET', maxResponseBytes: 262_144 });
    if (!this.permissionsAreOpen(epoch)) return { state: 'closed' };
    const rows = (result.value as { seats?: unknown }).seats;
    if (!Array.isArray(rows)) throw new ProductHttpError('UNAVAILABLE');
    const seats: SeatAccountRecord[] = [];
    for (const row of rows) {
      const seat = seatRow(row);
      if (!seat) throw new ProductHttpError('UNAVAILABLE');
      seats.push(seat);
    }
    if (!this.permissionsAreOpen(epoch)) return { state: 'closed' };
    return { seats };
  }

  private onSession(): void {
    const view = this.session.view();
    if (!view.signedIn) {
      this.becomeSignedOut();
      return;
    }
    if (this.snapshot.phase === 'ready' && this.snapshot.epoch === view.sessionEpoch) return;
    this.openGate = null;
    this.listsReady = false;
    this.permissions.dropLists();
    this.snapshot = {
      phase: 'ready',
      epoch: view.sessionEpoch,
      permissions: { state: 'pending' },
      sop: { state: 'pending' },
    };
    this.emit();
    void this.warmPermissions(view.sessionEpoch);
    void this.openSop(view.sessionEpoch);
  }

  private onPermissions(): void {
    if (this.suppress > 0 || !this.listsReady || !this.openGate) return;
    const snap = this.snapshot;
    if (snap.phase !== 'ready' || !this.sameEpoch(snap.epoch)) return;
    this.commitPermissions(snap.epoch, withPermissionsBody(this.openGate, this.permissions.view()));
  }

  private sameEpoch(epoch: number): boolean {
    const view = this.session.view();
    return view.signedIn && view.sessionEpoch === epoch;
  }

  private permissionCurrent(id: number, epoch: number): boolean {
    return id === this.permissionGeneration && this.sameEpoch(epoch);
  }

  private becomeSignedOut(): void {
    this.openGate = null;
    this.listsReady = false;
    this.permissions.dropLists();
    this.snapshot = { phase: 'signed-out' };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private commitPermissions(epoch: number, permissions: PermissionsUse): void {
    if (!this.sameEpoch(epoch)) return;
    const sop = this.snapshot.phase === 'ready' && this.snapshot.epoch === epoch
      ? this.snapshot.sop
      : { state: 'pending' as const };
    this.snapshot = { phase: 'ready', epoch, permissions, sop };
    this.emit();
  }

  private commitSop(epoch: number, sop: SopUse): void {
    if (!this.sameEpoch(epoch)) return;
    const permissions = this.snapshot.phase === 'ready' && this.snapshot.epoch === epoch
      ? this.snapshot.permissions
      : { state: 'pending' as const };
    this.snapshot = { phase: 'ready', epoch, permissions, sop };
    this.emit();
  }

  private droppedPermissions(): PermissionsUse {
    if (!this.session.view().signedIn) {
      if (this.snapshot.phase !== 'signed-out') this.becomeSignedOut();
      return { state: 'closed', recovery: null };
    }
    const snap = this.snapshot;
    if (snap.phase === 'ready' && snap.epoch === this.session.view().sessionEpoch) return snap.permissions;
    return { state: 'pending' };
  }

  private dropSop(): SopUse {
    if (!this.session.view().signedIn) {
      if (this.snapshot.phase !== 'signed-out') this.becomeSignedOut();
      return { state: 'pending' };
    }
    const snap = this.snapshot;
    if (snap.phase === 'ready' && snap.epoch === this.session.view().sessionEpoch) return snap.sop;
    return { state: 'pending' };
  }

  private abandonStale(id: number): PermissionsUse {
    if (id === this.permissionGeneration) this.permissions.dropLists();
    return this.droppedPermissions();
  }

  private applyAuthorization(id: number, epoch: number, read: AuthorizationRead): OpenGrant | PermissionsUse {
    if (!this.permissionCurrent(id, epoch) || (!read.ok && read.failure === 'stale')) return this.droppedPermissions();
    if (!read.ok) {
      if (read.failure === 'unauthorized') {
        this.becomeSignedOut();
        return { state: 'closed', recovery: null };
      }
      this.listsReady = false;
      this.openGate = null;
      const next: PermissionsUse = read.failure === 'forbidden'
        ? { state: 'closed', recovery: this.permissions.recovery() }
        : { state: 'unavailable' };
      this.permissions.dropLists();
      this.commitPermissions(epoch, next);
      return next;
    }
    const opened = grantUse(read.capabilities, this.permissions.recovery());
    if (opened.state !== 'open') {
      this.listsReady = false;
      this.openGate = null;
      this.permissions.dropLists();
      this.commitPermissions(epoch, opened);
      return opened;
    }
    this.openGate = opened;
    this.listsReady = false;
    this.commitPermissions(epoch, { state: 'open', body: null });
    return opened;
  }

  private async readAuthorization(epoch: number): Promise<AuthorizationRead> {
    try {
      const capabilities: { mayAllocate: readonly string[] }[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        if (seen.size >= 50) return { ok: false, failure: 'unavailable' };
        const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
        const result = await this.session.request(epoch, `/v1/intake/authorization?${query}`, { maxResponseBytes: 262_144 });
        if (!this.sameEpoch(epoch)) return { ok: false, failure: 'stale' };
        const page = parseContractSchema('IntakeAuthorization', result.value);
        for (const row of page.capabilities) capabilities.push({ mayAllocate: row.mayAllocate });
        cursor = page.nextCursor;
        if (cursor) {
          if (!page.capabilities.length || seen.has(cursor)) return { ok: false, failure: 'unavailable' };
          seen.add(cursor);
        }
      } while (cursor);
      return { ok: true, capabilities };
    } catch (error) {
      if (!this.sameEpoch(epoch) || (error instanceof ProductHttpError && error.code === 'STALE')) {
        return { ok: false, failure: 'stale' };
      }
      if (error instanceof ProductHttpError && error.code === 'UNAUTHORIZED') return { ok: false, failure: 'unauthorized' };
      if (error instanceof ProductHttpError && error.code === 'FORBIDDEN') return { ok: false, failure: 'forbidden' };
      return { ok: false, failure: 'unavailable' };
    }
  }

  private permissionsAreOpen(epoch: number): boolean {
    const snap = this.snapshot;
    return this.sameEpoch(epoch) && snap.phase === 'ready' && snap.epoch === epoch && snap.permissions.state === 'open';
  }
}

export function registerPageUseIpc(
  reader: PageUseReader | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
): () => void {
  const send = () => {
    const contents = dashboard();
    if (!contents || contents.isDestroyed() || !reader) return;
    contents.send(PAGE_USE_CHANGED_CHANNEL, reader.current());
  };
  const unsubscribe = reader?.subscribe(send) ?? (() => undefined);
  ipcMain.handle(PAGE_USE_CURRENT_CHANNEL, (event: IpcMainInvokeEvent) => {
    const contents = dashboard();
    if (!reader || !contents || !isTrustedMainFrameSender(event, [contents], devUrl())) {
      return { phase: 'signed-out' } satisfies PageUseSnapshot;
    }
    return reader.current();
  });
  return () => {
    unsubscribe();
    ipcMain.removeHandler(PAGE_USE_CURRENT_CHANNEL);
  };
}
