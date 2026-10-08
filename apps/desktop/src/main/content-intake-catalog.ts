import { emptyIntakeQueryContext, type IntakeQueryContext } from '../shared/content-intake-query';
import { isIntakeCatalogCommand, type IntakeCatalogCommand, type IntakeCatalogRow, type IntakeCatalogView } from '../shared/content-intake-catalog';
import { loadIntakeAccess, loadIntakeVocabulary } from './content-intake-access';
import { ContentIntakeUsage, IntakeUsageError, type IntakeCatalog, type IntakeUsageSession } from './content-intake-usage';

/** One Dashboard owns its selection and complete read; Query has a separate owner.
 * Discovery only supplies menu hints. Row domains come from the very qualification
 * that produced the snapshot, never from a mutable discovery response. */
export class ContentIntakeCatalog {
  private readonly usage: ContentIntakeUsage;
  private readonly unsubscribe: () => void;
  private readonly listeners = new Set<() => void>();
  private context: IntakeQueryContext = emptyIntakeQueryContext();
  private shown: IntakeCatalog | null = null;
  private active: AbortController | null = null;
  private generation = 0;
  private epoch: number;
  private menuDeadline = 0;
  private namesDeadline = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  constructor(private readonly session: IntakeUsageSession) {
    this.epoch = session.view().sessionEpoch;
    this.usage = new ContentIntakeUsage(session, () => { throw new IntakeUsageError('FORBIDDEN'); });
    this.usage.subscribe(event => { if (event !== 'updated' && this.shown) { this.shown = null; this.emit(); } });
    this.unsubscribe = session.subscribe(() => {
      const next = session.view();
      if (!next.signedIn || next.sessionEpoch !== this.epoch) {
        this.epoch = next.sessionEpoch; this.stop(); this.context = emptyIntakeQueryContext(); this.emit();
      }
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { if (!this.disposed) for (const listener of this.listeners) listener(); }
  private stop() {
    this.generation++; this.active?.abort(); this.active = null; this.shown = null; this.usage.cancelRefresh();
    if (this.timer) clearTimeout(this.timer); this.timer = null;
  }
  private arm() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.disposed || !this.context.validUntil) return;
    const time = Date.now(), mono = performance.now();
    const remaining = [Date.parse(this.context.validUntil)-time, this.menuDeadline-mono];
    if (this.context.shopNamesValidUntil) remaining.push(Date.parse(this.context.shopNamesValidUntil)-time, this.namesDeadline-mono);
    this.timer = setTimeout(() => { this.timer = null; this.view(); this.emit(); this.arm(); }, Math.max(1, Math.min(...remaining)));
  }
  view(): IntakeCatalogView {
    if (this.context.validUntil && (Date.now() >= Date.parse(this.context.validUntil) || performance.now() >= this.menuDeadline)) {
      this.stop(); this.context = emptyIntakeQueryContext();
    }
    if (this.context.shopNamesValidUntil && (Date.now() >= Date.parse(this.context.shopNamesValidUntil) || performance.now() >= this.namesDeadline)) {
      this.context = { ...this.context, shopNames: [], shopNamesValidUntil: null };
    }
    const snapshot = this.shown?.read() ?? null;
    if (this.shown && !snapshot) { this.shown = null; this.emit(); }
    const scopes = new Map(snapshot?.scopes.map(scope => [scope.sourceId, scope]) ?? []);
    if (snapshot && scopes.size !== snapshot.scopes.length) { this.shown = null; throw new IntakeUsageError('FORBIDDEN'); }
    // Dashboard renders a bounded whole set. A limit never becomes a partial catalogue.
    if (snapshot && snapshot.faq.length > 5000) { this.shown = null; throw new IntakeUsageError('LIMIT'); }
    const rows: IntakeCatalogRow[] = snapshot?.faq.map(({ sourceId, entry }, i) => {
      const scope = scopes.get(sourceId);
      if (!scope) throw new IntakeUsageError('FORBIDDEN');
      return { id: `entry-${i}`, domain: scope.domain, title: entry.title, answerText: entry.answerText,
        applicabilityNote: entry.applicabilityNote, riskNote: entry.riskNote, category: entry.category,
        scriptVersion: entry.scriptVersion, effectiveFrom: entry.effectiveFrom, effectiveTo: entry.effectiveTo };
    }) ?? [];
    if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > 2 * 1024 * 1024) { this.shown = null; throw new IntakeUsageError('LIMIT'); }
    return structuredClone({ signedIn: this.session.view().signedIn, busy: this.active !== null, context: this.context,
      releaseId: snapshot?.releaseId ?? null, validUntil: snapshot?.validUntil ?? null, rows });
  }
  async command(command: IntakeCatalogCommand): Promise<IntakeCatalogView> {
    if (this.disposed) throw new IntakeUsageError('STALE');
    if (!isIntakeCatalogCommand(command)) throw new IntakeUsageError('VALIDATION');
    if (command.action === 'cancel') { this.stop(); this.arm(); return this.view(); }
    if (command.action === 'select-conditions') {
      this.view();
      if (this.active || !this.context.shopId || !this.context.validUntil) throw new IntakeUsageError('STALE');
      if (command.productIds.some(id => !this.context.products.some(term => term.id === id))
        || command.scenarioIds.some(id => !this.context.scenarios.some(term => term.id === id))) throw new IntakeUsageError('FORBIDDEN');
      this.stop(); this.context = { ...this.context, productIds: [...command.productIds].sort(), scenarioIds: [...command.scenarioIds].sort() };
      this.usage.select({ shopId: this.context.shopId!, productIds: this.context.productIds, scenarioIds: this.context.scenarioIds });
      this.arm(); return this.view();
    }
    const previous = this.view().context;
    this.stop(); this.context = emptyIntakeQueryContext();
    const generation = this.generation, controller = new AbortController(); this.active = controller;
    const check = () => { if (this.disposed || generation !== this.generation || this.active !== controller || controller.signal.aborted) throw new IntakeUsageError('STALE'); };
    const startedAt = Date.now(), started = performance.now();
    try {
      const access = await loadIntakeAccess(this.session, controller.signal); check();
      // The menu deadline starts before vocabulary I/O, so waiting cannot extend it.
      this.menuDeadline = started + Math.max(0, Date.parse(access.validUntil)-startedAt);
      const shopId = command.action === 'select-shop' ? command.shopId
        : previous.shopId && access.shops.includes(previous.shopId) ? previous.shopId : access.shops.length === 1 ? access.shops[0]! : null;
      if (shopId !== null && !access.shops.includes(shopId)) throw new IntakeUsageError('FORBIDDEN');
      const menus = shopId === null ? { products: [], scenarios: [] } : await loadIntakeVocabulary(this.session, access, shopId, controller.signal); check();
      if (Date.now() >= Date.parse(access.validUntil) || performance.now() >= this.menuDeadline) throw new IntakeUsageError('EXPIRED');
      const preserve = command.action === 'refresh' && shopId === previous.shopId;
      const productIds = preserve ? previous.productIds : [];
      const scenarioIds = preserve ? previous.scenarioIds : [];
      // A disappearing condition must not silently broaden a previously selected read.
      if (productIds.some(id => !menus.products.some(p => p.id === id)) || scenarioIds.some(id => !menus.scenarios.some(p => p.id === id))) throw new IntakeUsageError('STALE');
      this.namesDeadline = access.shopNamesDeadline ?? 0;
      this.context = { ...emptyIntakeQueryContext(), ...menus, shops: access.shops, shopId, productIds, scenarioIds,
        shopNames: access.shopNames ?? [], shopNamesValidUntil: access.shopNamesValidUntil ?? null, validUntil: access.validUntil };
      if (shopId !== null) {
        this.usage.select({ shopId, productIds, scenarioIds });
        if (command.action === 'refresh') {
          const catalog = await this.usage.refresh(); check();
          if (Date.now() >= Date.parse(access.validUntil) || performance.now() >= this.menuDeadline) throw new IntakeUsageError('EXPIRED');
          this.shown = catalog;
        }
      }
      // Validate the full projection before declaring the operation successful.
      this.view();
    } finally {
      if (this.active === controller) { this.active = null; this.arm(); }
    }
    return this.view();
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.stop(); this.context = emptyIntakeQueryContext(); this.unsubscribe(); this.usage.dispose(); this.listeners.clear(); }
}
