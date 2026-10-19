import { parseContractSchema, type components } from '@customer-agent/contracts';
import { ProductHttpError } from './product-http';
import { IntakeUsageError, type IntakeUsageSession } from './content-intake-usage';

type C = components['schemas'];
export type IntakeAccess = {
  validUntil: string;
  shops: string[];
  shopNames?: { id: string; label: string }[];
  shopNamesValidUntil?: string | null;
  shopNamesDeadline?: number;
  sources: C['IntakeSource'][];
  capabilities: C['IntakeAuthorization']['capabilities'];
};

export function intakeAccessDenial(error: unknown): IntakeUsageError | null {
  if (!(error instanceof ProductHttpError)) return null;
  if (error.code === 'GONE' && (error.reason === 'NOT_FOUND' || error.reason === 'SCOPE_DENIED')) {
    return new IntakeUsageError('NO_PRINCIPAL');
  }
  if (error.reason === 'ORG_FACTS_UNAVAILABLE') return new IntakeUsageError('FACTS_EXPIRED');
  if (error.reason === 'ROLE_CEILING') return new IntakeUsageError('ROLE_UNKNOWN');
  return null;
}

/** Main-only discovery. All pages and both lists must agree before any menu is
 * returned. This is an expiring selection hint, never permission to read/copy;
 * ContentIntakeUsage must still obtain a server qualification for the selection.
 * Names use their own expiring read-only directory. Failure preserves IDs; neither
 * a name nor a brand-wide grant may introduce access to another shop.
 */
export async function loadIntakeAccess(session: IntakeUsageSession, signal?: AbortSignal): Promise<IntakeAccess & { factsVersion: number; policyVersion: number; revocationGeneration: number }> {
  const initial = session.view(), controller = new AbortController();
  if (!initial.signedIn) throw new IntakeUsageError('UNAUTHORIZED');
  const abort = () => controller.abort();
  const unsubscribe = session.subscribe(() => {
    const current = session.view();
    if (!current.signedIn || current.sessionEpoch !== initial.sessionEpoch) abort();
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const assertActive = () => {
    const current = session.view();
    if (controller.signal.aborted || !current.signedIn || current.sessionEpoch !== initial.sessionEpoch) throw new IntakeUsageError('STALE');
  };
  let bytes = 0;
  const MAX_BYTES = 8 * 1024 * 1024;
  async function request(path: string, cursor: string | null) {
    assertActive();
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
    const result = await session.request(initial.sessionEpoch, `/v1/intake/${path}?${query}`, {
      signal: controller.signal, maxResponseBytes: MAX_BYTES - bytes,
    });
    assertActive();
    bytes += Buffer.byteLength(JSON.stringify(result.value) ?? '');
    if (bytes >= MAX_BYTES) throw new IntakeUsageError('LIMIT');
    return result.value;
  }
  async function authorizations() {
    let cursor: string | null = null, meta: Omit<C['IntakeAuthorization'], 'capabilities' | 'nextCursor'> | null = null;
    const cursors = new Set<string>(), ids = new Set<string>(), capabilities: C['IntakeAuthorization']['capabilities'] = [];
    do {
      if (cursors.size >= 50) throw new IntakeUsageError('LIMIT');
      const page: C['IntakeAuthorization'] = parseContractSchema('IntakeAuthorization', await request('authorization', cursor));
      const { capabilities: rows, nextCursor, ...header } = page;
      if (meta && JSON.stringify(meta) !== JSON.stringify(header)) throw new IntakeUsageError('STALE');
      meta = header;
      for (const row of rows) {
        const id = row.scope.sourceId;
        if (id === null || ids.has(id) || Date.parse(row.validUntil) < Date.parse(header.validUntil)) throw new IntakeUsageError('FORBIDDEN');
        ids.add(id); capabilities.push(row);
      }
      cursor = nextCursor;
      if (cursor && (!rows.length || cursors.has(cursor))) throw new IntakeUsageError('FORBIDDEN');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return { ...meta!, capabilities };
  }
  try {
    const before = await authorizations();
    const deadline = performance.now() + Math.max(0, Date.parse(before.validUntil) - Date.now());
    const sources: C['IntakeSource'][] = [], ids = new Set<string>(), cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      if (cursors.size >= 50) throw new IntakeUsageError('LIMIT');
      const page: C['IntakeSourceList'] = parseContractSchema('IntakeSourceList', await request('sources', cursor));
      for (const src of page.items) {
        if (ids.has(src.scope.sourceId)) throw new IntakeUsageError('FORBIDDEN');
        ids.add(src.scope.sourceId); sources.push(src);
      }
      cursor = page.nextCursor;
      if (cursor && (!page.items.length || cursors.has(cursor))) throw new IntakeUsageError('FORBIDDEN');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    // The two frozen contracts have no common read token. A complete second
    // authority read detects observable rights changes, not an atomic multi-HTTP
    // snapshot. Source-only changes are rechecked when usage obtains qualification.
    const after = await authorizations();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new IntakeUsageError('STALE');
    if (Date.now() >= Date.parse(after.validUntil) || performance.now() >= deadline) throw new IntakeUsageError('EXPIRED');
    const capabilities = new Map(after.capabilities.map(c => [c.scope.sourceId, c]));
    if (sources.length !== capabilities.size) throw new IntakeUsageError('STALE');
    const shops = new Set<string>();
    for (const src of sources) {
      const cap = capabilities.get(src.scope.sourceId);
      if (!cap || Object.entries(src.scope).some(([key, value]) => Reflect.get(cap.scope, key) !== value)) throw new IntakeUsageError('STALE');
      if (src.contentIntakeMode === 'v2-preview' && src.scope.shopId !== null && cap.actions.includes('query')) shops.add(src.scope.shopId);
    }
    // Names are an optional display projection. A missing/changed directory must
    // never remove authorized IDs, grant a new ID, or retain a partial name set.
    let shopNames: { id: string; label: string }[] = [], shopNamesValidUntil: string | null = null, shopNamesDeadline = 0;
    if (shops.size) {
      try {
        const names = new Map<string,string>(), seen = new Set<string>();
        const nameStarted=performance.now(), nameStartedAt=Date.now();
        let nameCursor: string | null = null, nameUntil: string | null = null, nameDeadline = Infinity, nameBytes = 0;
        do {
          assertActive();
          if (seen.size >= 50) throw new IntakeUsageError('LIMIT');
          const query = new URLSearchParams({ limit:'100', ...(nameCursor ? { cursor:nameCursor } : {}) });
          const response = await session.request(initial.sessionEpoch, `/v1/intake/shop-directory?${query}`,
            { signal:controller.signal, maxResponseBytes:128*1024 });
          assertActive();
          const size = Buffer.byteLength(JSON.stringify(response.value) ?? ''); nameBytes += size;
          if (size > 128*1024 || nameBytes > 8*1024*1024) throw new IntakeUsageError('LIMIT');
          const page = parseContractSchema('IntakeShopDirectory', response.value);
          if (nameUntil !== null && page.validUntil !== nameUntil) throw new IntakeUsageError('STALE');
          if (nameUntil === null) { nameUntil = page.validUntil; nameDeadline = nameStarted+Math.max(0,Date.parse(nameUntil)-nameStartedAt); }
          if (Date.now() >= Date.parse(nameUntil) || performance.now() >= nameDeadline) throw new IntakeUsageError('EXPIRED');
          for (const item of page.items) {
            if (!shops.has(item.shopId) || names.has(item.shopId)) throw new IntakeUsageError('STALE');
            names.set(item.shopId,item.displayName);
          }
          nameCursor = page.nextCursor;
          if (nameCursor) {
            if (!page.items.length || seen.has(nameCursor)) throw new IntakeUsageError('STALE');
            seen.add(nameCursor);
          }
        } while (nameCursor);
        if (names.size !== shops.size) throw new IntakeUsageError('STALE');
        shopNames = [...names].map(([id,label])=>({id,label})); shopNamesValidUntil = nameUntil; shopNamesDeadline = nameDeadline;
      } catch {
        // Only optional names degrade. Session/explicit cancellation still fails
        // the entire read; the current authorized ID projection is kept below.
        assertActive();
      }
    }
    assertActive();
    if (Date.now() >= Date.parse(after.validUntil) || performance.now() >= deadline) throw new IntakeUsageError('EXPIRED');
    return { factsVersion: after.factsVersion, policyVersion: after.policyVersion, revocationGeneration: after.revocationGeneration, validUntil: after.validUntil, shops: [...shops].sort(), shopNames, shopNamesValidUntil, shopNamesDeadline, sources, capabilities: after.capabilities };
  } catch (error) {
    assertActive();
    if (error instanceof IntakeUsageError) throw error;
    const denial = intakeAccessDenial(error);
    if (denial) throw denial;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    throw new IntakeUsageError(code === 'UNAUTHORIZED' ? 'UNAUTHORIZED'
      : code === 'UNAVAILABLE' || code === 'OVERLOADED' || code === 'RATE_LIMITED' ? 'UNAVAILABLE' : 'FORBIDDEN');
  } finally {
    unsubscribe(); signal?.removeEventListener('abort', abort); controller.abort();
  }
}

/** Complete menu for the chosen shop; the entitlement endpoint remains the
 * authority. Do not discover options from a generic-only content snapshot. */
export async function loadIntakeVocabulary(session: IntakeUsageSession, access: IntakeAccess, shopId: string, signal: AbortSignal) {
  const initial = session.view(), started = performance.now();
  const budget = Math.max(0, Date.parse(access.validUntil) - Date.now());
  const check = () => {
    if (signal.aborted || !session.view().signedIn || session.view().sessionEpoch !== initial.sessionEpoch) throw new IntakeUsageError('STALE');
    if (Date.now() >= Date.parse(access.validUntil) || performance.now() - started >= budget) throw new IntakeUsageError('EXPIRED');
  };
  const allowed = new Set(access.capabilities.filter(c => c.actions.includes('query')).map(c => c.scope.sourceId));
  const sources = access.sources.filter(s => s.contentIntakeMode === 'v2-preview' && allowed.has(s.scope.sourceId));
  const brands = new Set(sources.filter(s => s.scope.shopId === shopId).map(s => s.scope.brandId));
  const selected = sources.filter(s => brands.has(s.scope.brandId) && (s.scope.shopId === shopId || s.scope.shopId === null));
  const terms = new Map<string, C['IntakeVocabulary']>();
  let bytes = 0;
  for (const src of selected) {
    let cursor: string | null = null;
    const cursors = new Set<string>(), seen = new Set<string>();
    do {
      check();
      if (cursors.size >= 50 || bytes >= 8 * 1024 * 1024) throw new IntakeUsageError('LIMIT');
      const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
      const response = await session.request(initial.sessionEpoch,
        `/v1/intake/sources/${encodeURIComponent(src.scope.sourceId)}/vocabulary?${query}`,
        { signal, maxResponseBytes: 8 * 1024 * 1024 - bytes });
      check(); bytes += Buffer.byteLength(JSON.stringify(response.value) ?? '');
      const page = parseContractSchema('IntakeVocabularyList', response.value);
      for (const term of page.items) {
        const scope = term.scope;
        if (!term.active || seen.has(term.id) || scope.sourceId !== null
          || scope.tenantId !== src.scope.tenantId || scope.appId !== src.scope.appId || scope.brandId !== src.scope.brandId
          || scope.domain !== src.scope.domain || (scope.shopId !== null && scope.shopId !== src.scope.shopId)) throw new IntakeUsageError('FORBIDDEN');
        seen.add(term.id);
        const previous = terms.get(term.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(term)) throw new IntakeUsageError('STALE');
        terms.set(term.id, term);
        if (terms.size > 5000) throw new IntakeUsageError('LIMIT');
      }
      cursor = page.nextCursor;
      if (cursor && (!page.items.length || cursors.has(cursor))) throw new IntakeUsageError('STALE');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  check();
  if (bytes >= 8 * 1024 * 1024) throw new IntakeUsageError('LIMIT');
  const options = (kind: 'product' | 'scenario') => [...terms.values()].filter(t => t.kind === kind)
    .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(t => ({ id: t.id, label: t.displayName }));
  return { products: options('product'), scenarios: options('scenario') };
}
