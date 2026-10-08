import { parseContractSchema } from '@customer-agent/contracts';
import { canonical, digest } from '../../src/content-intake/material.js';

/** Offline candidate only. The transport owner must authenticate the fixed tenant/app,
 * use tenant identity, user_id_type=open_id and department_id_type=open_department_id,
 * request job_titles page_size=50, and bound response bytes before buffering. No URL,
 * credential, employee discovery or production transport is implemented here. */
export type OrganizationTransport = {
  user(openId: string, signal: AbortSignal): Promise<string>;
  jobTitles(pageToken: string | undefined, signal: AbortSignal): Promise<string>;
};
export type OrganizationBinding = {
  tenantId: string; appId: string; principalId: string; openId: string; expectedFactsVersion: number;
};
export type OrganizationSnapshot = {
  principalId: string; expectedFactsVersion: number; departmentIds: string[];
  jobId: string; enabled: boolean; checkedAt: string; validUntil: string;
};
type Reason = 'INVALID_BINDING' | 'INVALID_RESPONSE' | 'IDENTITY_MISMATCH' | 'JOB_UNRESOLVED'
  | 'INCOMPLETE_DIRECTORY' | 'OBSERVATION_CHANGED' | 'OBSERVATION_EXPIRED' | 'DEPENDENCY_UNAVAILABLE';
export type OrganizationObservation = { ok: true; snapshot: OrganizationSnapshot;
  provenance: { mappingVersion: 'feishu-contact-job-title-v1-experiment'; directoryDigest: string; observedUntil: string } }
  | { ok: false; reason: Reason };
class Rejected extends Error { constructor(readonly reason: Reason) { super(reason); } }
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_PAGES = 100;
const OBSERVATION_MS = 300_000;
const TIMEOUT_MS = 180_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Rejected('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Rejected('INVALID_RESPONSE');
  }
  return value; // Exact matching: never trim, case-fold, localize or fuzzy-match titles.
}
function id(value: unknown): string {
  try { return parseContractSchema('IntakeId', value); } catch { throw new Rejected('INVALID_RESPONSE'); }
}
function data(body: string): Record<string, unknown> {
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Rejected('INVALID_RESPONSE');
  let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(body)); } catch { throw new Rejected('INVALID_RESPONSE'); }
  if (raw.code !== 0) throw new Rejected('DEPENDENCY_UNAVAILABLE');
  return record(raw.data);
}
function user(body: string, openId: string) {
  const raw = record(data(body).user);
  if (raw.open_id !== openId) throw new Rejected('IDENTITY_MISMATCH');
  const status = record(raw.status);
  const flags = ['is_activated', 'is_frozen', 'is_resigned', 'is_exited', 'is_unjoin'] as const;
  if (flags.some(key => typeof status[key] !== 'boolean')) throw new Rejected('INVALID_RESPONSE');
  if (!Array.isArray(raw.department_ids) || raw.department_ids.length < 1 || raw.department_ids.length > 100) {
    throw new Rejected('INVALID_RESPONSE');
  }
  const departmentIds = raw.department_ids.map(id).sort();
  if (new Set(departmentIds).size !== departmentIds.length) throw new Rejected('INVALID_RESPONSE');
  return { departmentIds, title: text(raw.job_title, 256), enabled: status.is_activated === true
    && flags.slice(1).every(key => status[key] === false) };
}

type Job = { id: string; name: string; enabled: boolean };
/** This detects observable drift across two complete directory scans and two user
 * reads; Feishu supplies no snapshot revision here, so equality cannot prove an
 * atomic upstream snapshot or a fresh cache. Formal adoption needs that policy and
 * persisted provenance approved separately. Output feeds the existing offline writer;
 * it never registers a principal, chooses a role or issues grants. A failed observation
 * produces no snapshot. Retain a successful snapshot unchanged for unknown-COMMIT retry;
 * calling observe again is a NEW observation, not recovery of a previous write. */
export function createFeishuOrganizationObserver(scope: { tenantId: string; appId: string },
  transport: OrganizationTransport, now: () => Promise<number>, maxDirectoryPages = MAX_PAGES) {
  if (!Number.isSafeInteger(maxDirectoryPages) || maxDirectoryPages < 1 || maxDirectoryPages > MAX_PAGES) throw new Error('INVALID_PAGE_BUDGET');
  const tenantId = id(scope.tenantId), appId = id(scope.appId);
  return async (binding: OrganizationBinding, parentSignal?: AbortSignal): Promise<OrganizationObservation> => {
    let frozen: OrganizationBinding;
    try {
      frozen = { tenantId: id(binding.tenantId), appId: id(binding.appId), principalId: id(binding.principalId),
        openId: id(binding.openId), expectedFactsVersion: binding.expectedFactsVersion };
      if (frozen.tenantId !== tenantId || frozen.appId !== appId || !Number.isSafeInteger(frozen.expectedFactsVersion)
        || frozen.expectedFactsVersion < 1 || frozen.expectedFactsVersion >= Number.MAX_SAFE_INTEGER) throw new Error();
    } catch { return { ok: false, reason: 'INVALID_BINDING' }; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    const signal = controller.signal;
    function checkpoint() {
      if (signal.aborted) throw new Rejected('DEPENDENCY_UNAVAILABLE');
    }
    async function directory(): Promise<Job[]> {
      const jobs = new Map<string, Job>(), tokens = new Set<string>();
      let token: string | undefined;
      for (let page = 0; page < maxDirectoryPages; page++) {
        checkpoint();
        const raw = data(await transport.jobTitles(token, signal));
        checkpoint();
        if (!Array.isArray(raw.items) || raw.items.length > 50 || typeof raw.has_more !== 'boolean') {
          throw new Rejected('INVALID_RESPONSE');
        }
        for (const item of raw.items) {
          const row = record(item), key = id(row.job_title_id);
          if (typeof row.status !== 'boolean') throw new Rejected('INVALID_RESPONSE');
          if (jobs.has(key)) throw new Rejected('INCOMPLETE_DIRECTORY');
          jobs.set(key, { id: key, name: text(row.name, 256), enabled: row.status });
        }
        if (!raw.has_more) {
          if (raw.page_token !== undefined && raw.page_token !== '') throw new Rejected('INCOMPLETE_DIRECTORY');
          return [...jobs.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        }
        token = text(raw.page_token, 2048);
        if (tokens.has(token)) throw new Rejected('INCOMPLETE_DIRECTORY');
        tokens.add(token);
      }
      throw new Rejected('INCOMPLETE_DIRECTORY');
    }
    async function observe(): Promise<OrganizationObservation> {
      checkpoint();
      const started = await now();
      checkpoint();
      if (!Number.isSafeInteger(started) || started < 0 || !Number.isFinite(new Date(started + OBSERVATION_MS).getTime())) {
        throw new Rejected('OBSERVATION_EXPIRED');
      }
      const first = user(await transport.user(frozen.openId, signal), frozen.openId);
      const jobs = await directory(), confirmedJobs = await directory();
      checkpoint();
      const last = user(await transport.user(frozen.openId, signal), frozen.openId);
      checkpoint();
      const finished = await now();
      checkpoint();
      if (!Number.isSafeInteger(finished) || finished < started || finished >= started + OBSERVATION_MS) {
        throw new Rejected('OBSERVATION_EXPIRED');
      }
      if (canonical(first) !== canonical(last) || canonical(jobs) !== canonical(confirmedJobs)) {
        throw new Rejected('OBSERVATION_CHANGED');
      }
      const matches = jobs.filter(job => job.name === last.title);
      if (matches.length !== 1 || !matches[0]!.enabled) throw new Rejected('JOB_UNRESOLVED');
      return { ok: true, snapshot: { principalId: frozen.principalId, expectedFactsVersion: frozen.expectedFactsVersion,
        departmentIds: last.departmentIds, jobId: matches[0]!.id, enabled: last.enabled,
        checkedAt: new Date(started).toISOString(), validUntil: new Date(started + OBSERVATION_MS).toISOString() },
      provenance: { mappingVersion: 'feishu-contact-job-title-v1-experiment', directoryDigest: digest(canonical(jobs)),
        observedUntil: new Date(finished).toISOString() } };
    }
    try {
      const stopped = new Promise<never>((_, reject) => {
        stop = () => reject(new Rejected('DEPENDENCY_UNAVAILABLE'));
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
        timer = setTimeout(abort, TIMEOUT_MS);
      });
      return await Promise.race([observe(), stopped]);
    } catch (error) {
      return { ok: false, reason: error instanceof Rejected ? error.reason : 'DEPENDENCY_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
      if (stop) signal.removeEventListener('abort', stop);
      parentSignal?.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}
