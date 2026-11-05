import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { parseContractSchema } from '@customer-agent/contracts';
import type { DashboardSopNode } from '../shared/dashboard-ops-loop';
import {
  canManageAccounts,
  grantUse,
  openGrantBrand,
  withPermissionsBody,
  type AccountsUse,
  type OpenGrant,
  type PageUseSnapshot,
  type PermissionsUse,
  type SettingsUse,
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

type AccessSettingsView = Readonly<{
  state: 'open' | 'closed';
  grants: 'open' | 'closed';
  accounts: 'open' | 'closed';
  accessRevision: number;
  expiresAt: string;
  denyReason: string | null;
}>;

type AccessSettingsRead =
  | { readonly ok: true; readonly value: AccessSettingsView }
  | { readonly ok: false; readonly failure: 'unauthorized' | 'unavailable' | 'stale' };

const pendingSettings = (): SettingsUse => ({
  accessRevision: null,
  expiresAt: null,
  grants: { state: 'pending' },
  accounts: 'pending',
});

const closedSettings = (): SettingsUse => ({
  accessRevision: null,
  expiresAt: null,
  grants: { state: 'closed', recovery: null },
  accounts: 'closed',
});

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
  private settingsExpiry: ReturnType<typeof setTimeout> | null = null;
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
    if (this.settingsExpiry) clearTimeout(this.settingsExpiry);
    this.settingsExpiry = null;
    this.stopSession();
    this.stopPermissions();
    this.listeners.clear();
    this.permissions.dispose();
  }

  async warmSettings(epoch: number): Promise<SettingsUse> {
    const id = ++this.permissionGeneration;
    return this.applySettings(id, epoch, await this.readAccessSettings(epoch));
  }

  async refreshPermissions(epoch: number): Promise<SettingsUse> {
    const id = ++this.permissionGeneration;
    const first = this.applySettings(id, epoch, await this.readAccessSettings(epoch));
    if (!this.permissionCurrent(id, epoch)) return this.droppedSettings();
    const gate = this.openGate;
    if (!gate || !isOpenGrant(gate)) return first;
    const firstRevision = first.accessRevision;
    this.suppress += 1;
    try {
      const body = await this.permissions.loadLists(gate, epoch);
      if (!this.permissionCurrent(id, epoch)) return this.abandonStale(id);
      const still = this.applySettings(id, epoch, await this.readAccessSettings(epoch));
      const currentGate = this.openGate;
      if (!currentGate || !isOpenGrant(currentGate)) {
        this.permissions.dropLists();
        this.listsReady = false;
        return still;
      }
      if (still.accessRevision !== firstRevision) {
        this.permissions.dropLists();
        this.listsReady = false;
        this.openGate = null;
        return still;
      }
      this.listsReady = true;
      const next: SettingsUse = {
        ...still,
        grants: withPermissionsBody(currentGate, body),
      };
      this.commitSettings(epoch, next);
      return next;
    } catch {
      if (!this.permissionCurrent(id, epoch)) return this.abandonStale(id);
      this.permissions.dropLists();
      this.listsReady = false;
      this.openGate = null;
      const accounts = this.currentAccounts();
      const next: SettingsUse = {
        ...this.snapshotSettings(),
        grants: { state: 'unavailable' },
        accounts,
      };
      this.commitSettings(epoch, next);
      return next;
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
    if (!this.accountsAreOpen(epoch)) return { state: 'closed' };
    const result = await this.session.request(epoch, '/v1/intake/seats', { method: 'GET', maxResponseBytes: 262_144 });
    if (!this.accountsAreOpen(epoch)) return { state: 'closed' };
    const rows = (result.value as { seats?: unknown }).seats;
    if (!Array.isArray(rows)) throw new ProductHttpError('UNAVAILABLE');
    const seats: SeatAccountRecord[] = [];
    for (const row of rows) {
      const seat = seatRow(row);
      if (!seat) throw new ProductHttpError('UNAVAILABLE');
      seats.push(seat);
    }
    if (!this.accountsAreOpen(epoch)) return { state: 'closed' };
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
      settings: pendingSettings(),
      sop: { state: 'pending' },
    };
    this.emit();
    void this.warmSettings(view.sessionEpoch);
    void this.openSop(view.sessionEpoch);
  }

  private onPermissions(): void {
    if (this.suppress > 0 || !this.listsReady || !this.openGate) return;
    const snap = this.snapshot;
    if (snap.phase !== 'ready' || !this.sameEpoch(snap.epoch)) return;
    this.commitSettings(snap.epoch, {
      ...snap.settings,
      grants: withPermissionsBody(this.openGate, this.permissions.view()),
      accounts: snap.settings.accounts,
    });
  }

  private sameEpoch(epoch: number): boolean {
    const view = this.session.view();
    return view.signedIn && view.sessionEpoch === epoch;
  }

  private permissionCurrent(id: number, epoch: number): boolean {
    return id === this.permissionGeneration && this.sameEpoch(epoch);
  }

  private becomeSignedOut(): void {
    if (this.settingsExpiry) clearTimeout(this.settingsExpiry);
    this.settingsExpiry = null;
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

  private commitSettings(epoch: number, settings: SettingsUse): void {
    if (!this.sameEpoch(epoch)) return;
    this.armSettingsExpiry(epoch, settings);
    const sop = this.snapshot.phase === 'ready' && this.snapshot.epoch === epoch
      ? this.snapshot.sop
      : { state: 'pending' as const };
    this.snapshot = { phase: 'ready', epoch, settings, sop };
    this.emit();
  }

  private armSettingsExpiry(epoch: number, settings: SettingsUse): void {
    if (this.settingsExpiry) clearTimeout(this.settingsExpiry);
    this.settingsExpiry = null;
    if (!settings.expiresAt || (settings.grants.state !== 'open' && settings.accounts !== 'open')) return;
    const delay = Math.max(0, Date.parse(settings.expiresAt) - Date.now());
    this.settingsExpiry = setTimeout(() => {
      this.settingsExpiry = null;
      const current = this.snapshot;
      if (current.phase !== 'ready' || current.epoch !== epoch || !this.sameEpoch(epoch)
        || current.settings.accessRevision !== settings.accessRevision) return;
      this.openGate = null;
      this.listsReady = false;
      this.permissions.dropLists();
      this.commitSettings(epoch, {
        ...current.settings,
        expiresAt: null,
        grants: { state: 'closed', recovery: '权限已到期，请重新读取。' },
        accounts: 'closed',
      });
      void this.warmSettings(epoch);
    }, Math.min(2_147_483_647, Math.max(1, delay)));
  }

  private commitSop(epoch: number, sop: SopUse): void {
    if (!this.sameEpoch(epoch)) return;
    const settings = this.snapshot.phase === 'ready' && this.snapshot.epoch === epoch
      ? this.snapshot.settings
      : pendingSettings();
    this.snapshot = { phase: 'ready', epoch, settings, sop };
    this.emit();
  }

  private droppedSettings(): SettingsUse {
    if (!this.session.view().signedIn) {
      if (this.snapshot.phase !== 'signed-out') this.becomeSignedOut();
      return closedSettings();
    }
    const snap = this.snapshot;
    if (snap.phase === 'ready' && snap.epoch === this.session.view().sessionEpoch) return snap.settings;
    return pendingSettings();
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

  private abandonStale(id: number): SettingsUse {
    if (id === this.permissionGeneration) this.permissions.dropLists();
    return this.droppedSettings();
  }

  private applySettings(
    id: number,
    epoch: number,
    read: AccessSettingsRead,
  ): SettingsUse {
    if (!this.permissionCurrent(id, epoch) || (!read.ok && read.failure === 'stale')) {
      return this.droppedSettings();
    }
    if (!read.ok && read.failure === 'unauthorized') {
      this.becomeSignedOut();
      return closedSettings();
    }

    let grants: PermissionsUse;
    if (read.ok) {
      const opened = read.value.grants === 'open'
        ? grantUse([{ mayAllocate: ['query'] }], this.permissions.recovery())
        : { state: 'closed' as const, recovery: this.permissions.recovery() };
      if (opened.state === 'open') {
        this.openGate = opened;
        grants = { state: 'open', body: null };
      } else {
        grants = opened;
      }
    } else {
      grants = { state: 'unavailable' };
    }

    if (grants.state !== 'open') {
      this.openGate = null;
      this.permissions.dropLists();
    }
    this.listsReady = false;

    let accounts: AccountsUse;
    if (read.ok) accounts = read.value.accounts === 'open' ? 'open' : 'closed';
    else accounts = 'unavailable';

    const next: SettingsUse = {
      accessRevision: read.ok ? read.value.accessRevision : null,
      expiresAt: read.ok ? read.value.expiresAt : null,
      grants,
      accounts,
    };
    this.commitSettings(epoch, next);
    return next;
  }

  private snapshotSettings(): SettingsUse {
    const snap = this.snapshot;
    return snap.phase === 'ready' ? snap.settings : pendingSettings();
  }

  private async readAccessSettings(epoch: number): Promise<AccessSettingsRead> {
    try {
      const result = await this.session.request(epoch, '/v1/access/settings', {
        method: 'GET',
        maxResponseBytes: 16_384,
      });
      if (!this.sameEpoch(epoch)) return { ok: false, failure: 'stale' };
      if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
        return { ok: false, failure: 'unavailable' };
      }
      const value = result.value as Record<string, unknown>;
      if (Object.keys(value).length !== 6
        || !['open', 'closed'].includes(value.state as string)
        || !['open', 'closed'].includes(value.grants as string)
        || !['open', 'closed'].includes(value.accounts as string)
        || !Number.isSafeInteger(value.accessRevision)
        || (value.accessRevision as number) < 1
        || typeof value.expiresAt !== 'string'
        || !Number.isFinite(Date.parse(value.expiresAt))
        || (value.denyReason !== null && typeof value.denyReason !== 'string')) {
        return { ok: false, failure: 'unavailable' };
      }
      return {
        ok: true,
        value: value as AccessSettingsView,
      };
    } catch (error) {
      if (!this.sameEpoch(epoch) || (error instanceof ProductHttpError && error.code === 'STALE')) {
        return { ok: false, failure: 'stale' };
      }
      if (error instanceof ProductHttpError && error.code === 'UNAUTHORIZED') return { ok: false, failure: 'unauthorized' };
      return { ok: false, failure: 'unavailable' };
    }
  }

  private currentAccounts(): AccountsUse {
    const snap = this.snapshot;
    return snap.phase === 'ready' && this.sameEpoch(snap.epoch) ? snap.settings.accounts : 'pending';
  }

  private accountsAreOpen(epoch: number): boolean {
    const snap = this.snapshot;
    return this.sameEpoch(epoch) && snap.phase === 'ready' && snap.epoch === epoch
      && canManageAccounts(snap);
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
