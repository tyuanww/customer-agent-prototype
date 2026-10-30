import { randomUUID } from 'node:crypto';
import { buildBm25Index, characterUnigramBigramTerms, rankBm25 } from '@customer-agent/retrieval-core';
import { emptyIntakeQueryContext, isIntakeSelection, type IntakeQuerySelection, type IntakeQueryContext, type IntakeQueryRow, type IntakeQueryInvalidationEvent } from '../shared/content-intake-query';
import { loadIntakeAccess, loadIntakeVocabulary } from './content-intake-access';
import { ContentIntakeUsage, IntakeUsageError, type IntakeCatalog, type IntakeUsageSession } from './content-intake-usage';

/** One Query window's context. Discovery is a menu, never a qualification.
 * Every search obtains a fresh complete qualified snapshot. Only the displayed
 * Top 3 keys may copy, and the catalog rechecks server authority before writing. */
export class ContentIntakeQuery {
  private readonly usage: ContentIntakeUsage;
  private readonly unsubscribe: () => void;
  private generation = 0;
  private discovery: AbortController | null = null;
  private copyRequest: AbortController | null = null;
  private context: IntakeQueryContext = emptyIntakeQueryContext();
  private shown: { catalog: IntakeCatalog; keys: Set<string>; contextId: string } | null = null;
  private menuDeadline = 0;
  private namesDeadline = 0;
  private epoch: number;
  private disposed = false;
  private listeners = new Set<(event: IntakeQueryInvalidationEvent) => void>();
  constructor(private readonly session: IntakeUsageSession, writeClipboard: (text: string) => void) {
    this.epoch = session.view().sessionEpoch;
    this.usage = new ContentIntakeUsage(session, writeClipboard);
    this.usage.subscribe(event => {
      if (event === 'updated') return;
      const affected = this.shown;
      this.copyRequest?.abort(); this.copyRequest = null;
      this.shown = null;
      // A refresh failure is returned to its caller; expiry of an older catalog
      // must not be attributed to a replacement search that has not completed.
      if (affected) for (const listener of this.listeners) listener({ reason: event, contextId: affected.contextId });
    });
    this.unsubscribe = session.subscribe(() => {
      const current = session.view();
      if (!current.signedIn || current.sessionEpoch !== this.epoch) {
        this.epoch = current.sessionEpoch; this.discovery?.abort(); this.discovery = null; this.cancel(); this.context = emptyIntakeQueryContext();
      }
    });
  }
  subscribe(listener: (event: IntakeQueryInvalidationEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  cancel() {
    this.generation++;
    this.copyRequest?.abort(); this.copyRequest = null;
    this.usage.cancelRefresh(); this.shown = null;
  }
  async access(shopId?: string): Promise<IntakeQueryContext> {
    this.cancel();
    const previous = this.context; this.context = emptyIntakeQueryContext();
    this.discovery?.abort();
    const controller = new AbortController(); this.discovery = controller;
    try {
      const access = await loadIntakeAccess(this.session, controller.signal);
      if (this.disposed || controller.signal.aborted || this.discovery !== controller) throw new IntakeUsageError('STALE');
      const selected = shopId ?? previous.shopId ?? (access.shops.length === 1 ? access.shops[0]! : null);
      if (access.shops.length === 0 || (selected !== null && !access.shops.includes(selected))) {
        throw new IntakeUsageError('NO_GRANT');
      }
      const menus = selected === null ? { products: [], scenarios: [] }
        : await loadIntakeVocabulary(this.session, access, selected, controller.signal);
      if (this.disposed || controller.signal.aborted || this.discovery !== controller) throw new IntakeUsageError('STALE');
      this.namesDeadline = access.shopNamesDeadline ?? 0;
      const namesFresh = this.namesDeadline>performance.now() && !!access.shopNamesValidUntil && Date.now()<Date.parse(access.shopNamesValidUntil);
      this.context = { ...emptyIntakeQueryContext(), ...menus, shops: access.shops, shopNames: namesFresh ? access.shopNames ?? [] : [], shopNamesValidUntil: namesFresh ? new Date(Math.min(Date.parse(access.shopNamesValidUntil!),Date.now()+this.namesDeadline-performance.now())).toISOString() : null, shopId: selected, validUntil: access.validUntil };
      this.menuDeadline = performance.now() + Math.max(0, Date.parse(access.validUntil) - Date.now());
      if (selected !== null) this.usage.select({ shopId: selected, productIds: [], scenarioIds: [] });
      return structuredClone(this.context);
    } finally { if (this.discovery === controller) this.discovery = null; }
  }
  selectConditions(selection: IntakeQuerySelection): IntakeQueryContext {
    this.cancel();
    this.assertMenu();
    if (!isIntakeSelection(selection)
      || selection.productIds.some(id => !this.context.products.some(p => p.id === id))
      || selection.scenarioIds.some(id => !this.context.scenarios.some(p => p.id === id))) throw new IntakeUsageError('FORBIDDEN');
    if (performance.now()>=this.namesDeadline || (this.context.shopNamesValidUntil && Date.now()>=Date.parse(this.context.shopNamesValidUntil))) { this.context.shopNames=[];this.context.shopNamesValidUntil=null; }
    this.context = { ...this.context, productIds: [...selection.productIds].sort(), scenarioIds: [...selection.scenarioIds].sort() };
    this.usage.select({ shopId: this.context.shopId!, productIds: this.context.productIds, scenarioIds: this.context.scenarioIds });
    return structuredClone(this.context);
  }
  private assertMenu() {
    if (this.disposed || this.discovery || !this.context.shopId) throw new IntakeUsageError('FORBIDDEN');
    if (!this.context.validUntil || Date.now() >= Date.parse(this.context.validUntil) || performance.now() >= this.menuDeadline) {
      throw new IntakeUsageError('EXPIRED');
    }
  }
  async search(queryText: string, contextId: string = randomUUID()): Promise<IntakeQueryRow[]> {
    this.cancel();
    this.assertMenu();
    const generation = this.generation;
    const catalog = await this.usage.refresh();
    if (this.disposed || generation !== this.generation) throw new IntakeUsageError('STALE');
    const snapshot = catalog.read();
    if (!snapshot) throw new IntakeUsageError('EXPIRED');
    // Bound Main's synchronous work independently of the transport budget.
    // Refuse the whole query, never silently truncate the authorized catalog.
    const indexBytes = snapshot.faq.reduce((sum, { entry }) => sum + Buffer.byteLength(
      entry.title + entry.answerText + entry.questions.filter(q => q.active).map(q => q.text).join('\n')), 0);
    if (snapshot.faq.length > 5000 || indexBytes > 2 * 1024 * 1024) throw new IntakeUsageError('LIMIT');
    const indexedRows = snapshot.faq.map((row, i) => ({ id: String(i).padStart(8, '0'), row }));
    const index = buildBm25Index(indexedRows.map(({ id, row }) => ({ id, fields: [
      { name: 'question', text: [row.entry.title, ...row.entry.questions.filter(q => q.active).map(q => q.text)].join('\n') },
      { name: 'answer', text: row.entry.answerText },
    ] })), characterUnigramBigramTerms);
    const hits = rankBm25(characterUnigramBigramTerms(queryText), index,
      { k1: 1.2, b: 0.75, fieldWeights: [{ field: 'question', weight: 3 }, { field: 'answer', weight: 1 }] }).slice(0, 3);
    const byKey = new Map(indexedRows.map(({ id, row }) => [id, row]));
    const rows: IntakeQueryRow[] = hits.map((hit, i) => {
      const { entry, key } = byKey.get(hit.id)!;
      return { kind: 'intake', key, rank: (i + 1) as 1 | 2 | 3, title: entry.title,
        answerText: entry.answerText, applicabilityNote: entry.applicabilityNote, riskNote: entry.riskNote,
        releaseId: snapshot.releaseId, validUntil: snapshot.validUntil };
    });
    // Yield so already-queued cancellation/session/expiry signals take effect.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (this.disposed || generation !== this.generation) throw new IntakeUsageError('STALE');
    if (!catalog.read()) throw new IntakeUsageError('EXPIRED');
    this.shown = { catalog, keys: new Set(rows.map(row => row.key)), contextId };
    return rows;
  }
  async copy(key: string) {
    const shown = this.shown;
    if (!shown?.keys.has(key)) throw new IntakeUsageError('STALE');
    this.copyRequest?.abort();
    const controller = new AbortController(); this.copyRequest = controller;
    try {
      return await shown.catalog.copy(key, { signal: controller.signal,
        stillShown: () => this.shown === shown && shown.keys.has(key) && this.copyRequest === controller });
    } finally { if (this.copyRequest === controller) this.copyRequest = null; }
  }
  dispose() { this.disposed = true; this.discovery?.abort(); this.discovery = null; this.cancel(); this.unsubscribe(); this.usage.dispose(); this.listeners.clear(); }
}
