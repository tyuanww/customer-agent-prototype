import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeStackReadPath } from './packaged-retrieval-paths';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index';
import { assertOffRepoIndexPath } from './retrieval-index-store.ts';
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

function windowLabel(from: unknown, to: unknown): string {
  if (typeof from !== 'string' || from.length < 1) return '本机目录';
  const start = from.slice(0, 10);
  const end = typeof to === 'string' && to.length > 0 ? to.slice(0, 10) : '长期有效';
  return `${start} → ${end}`;
}

function entryFromHydrate(item: object, releaseId: string): DashboardWordingEntry | null {
  const record = asRecord(item);
  if (!record) return null;
  const scriptId = record.scriptId;
  const title = record.title;
  const answer = record.answerText;
  if (typeof scriptId !== 'string' || scriptId.length < 1) return null;
  if (typeof title !== 'string' || title.trim().length < 1) return null;
  if (typeof answer !== 'string' || answer.trim().length < 1) return null;
  const questionText = typeof record.questionText === 'string' ? record.questionText.trim() : '';
  return Object.freeze({
    scriptId,
    domain: domainOf(record.category),
    title: title.trim(),
    scene: questionText.length > 0 ? questionText : title.trim(),
    answerPreview: answer,
    platform: platformLabel(record.platformScope),
    version: releaseId,
    effectiveWindow: windowLabel(record.effectiveFrom, record.effectiveTo),
    risk: riskOf(record.riskLevel),
    lifecycle: 'published',
    lifecycleLabel: '已发布',
    ownerRole: '当前发布',
    dataClass: 'local-catalog',
  });
}

function entryFromIndex(
  script: Readonly<{ scriptId: string; title: string; questionText: string; answerText: string; category?: string }>,
  releaseId: string | null,
): DashboardWordingEntry | null {
  if (script.answerText.trim().length < 1) return null;
  const scene = script.questionText.trim().length > 0 ? script.questionText.trim() : script.title;
  return Object.freeze({
    scriptId: script.scriptId,
    domain: domainOf(script.category),
    title: script.title,
    scene,
    answerPreview: script.answerText,
    platform: '千牛 / 抖音',
    version: releaseId ?? 'local-index',
    effectiveWindow: releaseId ? '当前发布' : '本机目录',
    risk: 'low',
    lifecycle: 'published',
    lifecycleLabel: '已发布',
    ownerRole: releaseId ? '当前发布' : '本机话术库',
    dataClass: 'local-catalog',
  });
}

export function listDashboardWording(): DashboardWordingView {
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
  return Object.freeze({
    ok: true,
    releaseId: hydrateRelease,
    total: entries.length,
    entries: Object.freeze(entries),
  });
}
