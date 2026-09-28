import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeStackReadPath } from './packaged-retrieval-paths';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index';
import { assertOffRepoIndexPath } from './retrieval-index-store.ts';
import type { HydrateSnapshotItem } from './hydrate-catalog.ts';
import type { DashboardWordingDomain, DashboardWordingEntry, DashboardWordingView } from '../shared/dashboard-wording';

function desktopRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

function offRepoFile(path: string): string | null {
  try {
    return assertOffRepoIndexPath(path, desktopRepoRoot());
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function domainOf(category: unknown): DashboardWordingDomain {
  if (category === 'product' || category === 'campaign' || category === 'presale' || category === 'aftersale') {
    return category;
  }
  return 'product';
}

function riskOf(value: unknown): DashboardWordingEntry['risk'] {
  if (value === 'medium' || value === 'high' || value === 'low') return value;
  return 'low';
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function hydratePath(): string | null {
  return offRepoFile(runtimeStackReadPath('CUSTOMER_AGENT_HYDRATE_INDEX', 'retrieval-hydrate.json'));
}

function indexPath(): string | null {
  return offRepoFile(runtimeStackReadPath('CUSTOMER_AGENT_RETRIEVAL_INDEX', 'retrieval-index.json'));
}

function platformLabel(scope: unknown): string {
  if (!Array.isArray(scope) || scope.length === 0) return '千牛 / 抖音';
  const labels = scope.map((item) => (item === 'douyin' ? '抖音' : item === 'qianniu' ? '千牛' : null)).filter(Boolean);
  return labels.length > 0 ? labels.join(' / ') : '千牛 / 抖音';
}

function windowLabel(from: unknown, to: unknown, empty = '本机目录'): string {
  if (typeof from !== 'string' || from.length < 1) return empty;
  const start = from.slice(0, 10);
  const end = typeof to === 'string' && to.length > 0 ? to.slice(0, 10) : '长期有效';
  return `${start} → ${end}`;
}

type CatalogDraft = Readonly<{
  scriptId: string;
  category: unknown;
  title: string;
  questionText: string;
  answerText: string;
  platformScope: unknown;
  scriptVersion: unknown;
  effectiveFrom: unknown;
  effectiveTo: unknown;
  windowEmpty: string;
  ownerRole: string;
  dataClass: DashboardWordingEntry['dataClass'];
  risk: unknown;
}>;

function entryFromDraft(draft: CatalogDraft, releaseId: string): DashboardWordingEntry | null {
  const title = draft.title.trim();
  const answer = draft.answerText.trim();
  if (draft.scriptId.length < 1 || title.length < 1 || answer.length < 1) return null;
  const scene = draft.questionText.trim().length > 0 ? draft.questionText.trim() : title;
  const scriptVersion = typeof draft.scriptVersion === 'number' && Number.isInteger(draft.scriptVersion) && draft.scriptVersion >= 1
    ? draft.scriptVersion
    : null;
  const effectiveFrom = typeof draft.effectiveFrom === 'string' && draft.effectiveFrom.length > 0
    ? draft.effectiveFrom
    : null;
  const effectiveTo = typeof draft.effectiveTo === 'string' ? draft.effectiveTo : null;
  return Object.freeze({
    scriptId: draft.scriptId,
    domain: domainOf(draft.category),
    title,
    scene,
    answerPreview: answer,
    platform: platformLabel(draft.platformScope),
    version: releaseId,
    scriptVersion,
    effectiveFrom,
    effectiveTo,
    effectiveWindow: windowLabel(effectiveFrom, effectiveTo, draft.windowEmpty),
    risk: riskOf(draft.risk),
    lifecycle: 'published',
    lifecycleLabel: '已发布',
    ownerRole: draft.ownerRole,
    dataClass: draft.dataClass,
  });
}

function entryFromHydrate(item: object, releaseId: string): DashboardWordingEntry | null {
  const record = asRecord(item);
  if (!record || typeof record.scriptId !== 'string' || typeof record.title !== 'string' || typeof record.answerText !== 'string') {
    return null;
  }
  return entryFromDraft({
    scriptId: record.scriptId,
    category: record.category,
    title: record.title,
    questionText: typeof record.questionText === 'string' ? record.questionText : '',
    answerText: record.answerText,
    platformScope: record.platformScope,
    scriptVersion: record.scriptVersion,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    windowEmpty: '本机目录',
    ownerRole: '本机话术库',
    dataClass: 'local-catalog',
    risk: record.riskLevel,
  }, releaseId);
}

function entryFromSnapshotItem(item: HydrateSnapshotItem, releaseId: string): DashboardWordingEntry | null {
  return entryFromDraft({
    scriptId: item.script_id,
    category: item.category,
    title: item.title,
    questionText: item.questions?.[0]?.question_text ?? '',
    answerText: item.answer_text,
    platformScope: item.platform_scope,
    scriptVersion: item.script_version,
    effectiveFrom: item.effective_from,
    effectiveTo: item.effective_to,
    windowEmpty: '当前发布',
    ownerRole: '当前发布',
    dataClass: 'current-release',
    risk: item.risk_level,
  }, releaseId);
}

function entryFromIndex(
  script: Readonly<{ scriptId: string; title: string; questionText: string; answerText: string; category?: string }>,
  releaseId: string | null,
): DashboardWordingEntry | null {
  return entryFromDraft({
    scriptId: script.scriptId,
    category: script.category,
    title: script.title,
    questionText: script.questionText,
    answerText: script.answerText,
    platformScope: null,
    scriptVersion: null,
    effectiveFrom: null,
    effectiveTo: null,
    windowEmpty: releaseId ? '当前发布' : '本机目录',
    ownerRole: releaseId ? '当前发布' : '本机话术库',
    dataClass: 'local-catalog',
    risk: 'low',
  }, releaseId ?? 'local-index');
}

function wordingView(
  releaseId: string | null,
  entries: readonly DashboardWordingEntry[],
  catalogRefreshedAt: string | null,
  matchesLease: boolean,
): DashboardWordingView {
  return Object.freeze({
    ok: true as const,
    releaseId,
    total: entries.length,
    entries: Object.freeze(entries),
    catalogRefreshedAt,
    matchesLease,
  });
}

export function listDashboardWording(
  liveCatalog?: { releaseId: string; items: readonly HydrateSnapshotItem[] } | null,
): DashboardWordingView {
  if (liveCatalog && liveCatalog.releaseId.length > 0 && liveCatalog.items.length > 0) {
    const entries: DashboardWordingEntry[] = [];
    for (const item of liveCatalog.items) {
      const entry = entryFromSnapshotItem(item, liveCatalog.releaseId);
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      return wordingView(liveCatalog.releaseId, entries, null, true);
    }
  }

  const hydrateFile = hydratePath();
  const hydrateRaw = hydrateFile ? asRecord(readJson(hydrateFile)) : null;
  const hydrateRelease = hydrateRaw && typeof hydrateRaw.releaseId === 'string' ? hydrateRaw.releaseId : null;
  const hydrateScripts = hydrateRaw && Array.isArray(hydrateRaw.scripts) ? hydrateRaw.scripts : [];
  const fromHydrate: DashboardWordingEntry[] = [];
  for (const item of hydrateScripts) {
    if (!item || typeof item !== 'object') continue;
    const entry = entryFromHydrate(item, hydrateRelease ?? 'local-hydrate');
    if (entry) fromHydrate.push(entry);
  }

  let fromIndex: DashboardWordingEntry[] = [];
  const indexFile = indexPath();
  if (indexFile && existsSync(indexFile)) {
    try {
      const document = parseRetrievalIndex(readFileSync(indexFile, 'utf8'));
      const scripts = document ? scriptsOf(document) : [];
      fromIndex = scripts.flatMap((script) => {
        const entry = entryFromIndex(script, hydrateRelease);
        return entry ? [entry] : [];
      });
    } catch {
      fromIndex = [];
    }
  }

  const entries = fromHydrate.length > 0 ? fromHydrate : fromIndex;
  let catalogRefreshedAt: string | null = null;
  if (fromHydrate.length > 0 && hydrateFile) {
    try {
      catalogRefreshedAt = statSync(hydrateFile).mtime.toISOString();
    } catch {
      catalogRefreshedAt = null;
    }
  }
  return wordingView(hydrateRelease, entries, catalogRefreshedAt, false);
}
