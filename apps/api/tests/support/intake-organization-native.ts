import type { OrganizationTransport } from '../../experiments/intake-organization/feishu-observer.js';

/** Invented native-shaped contact responses; never copied from a tenant. */
export function nativeOrganizationFixture() {
  const person = { open_id: 'synthetic-open-agent', name: '合成坐席甲', job_title: '合成坐席',
    department_ids: ['dept-a'], status: { is_activated: true, is_frozen: false, is_resigned: false,
      is_exited: false, is_unjoin: false } };
  const pages: Record<string, { items: { job_title_id: string; name: string; status: boolean }[];
    has_more: boolean; page_token?: string }> = {
    first: { items: [{ job_title_id: 'job-unused', name: '合成停用岗位', status: false }], has_more: true, page_token: 'second' },
    second: { items: [{ job_title_id: 'job-agent', name: '合成坐席', status: true }], has_more: false },
  };
  const calls: { kind: string; key: string | undefined; signal: AbortSignal }[] = [];
  const transport: OrganizationTransport = {
    async user(key, signal) { calls.push({ kind: 'user', key, signal }); return JSON.stringify({ code: 0, data: { user: person } }); },
    async jobTitles(key, signal) { calls.push({ kind: 'jobs', key, signal }); return JSON.stringify({ code: 0, data: pages[key ?? 'first'] }); },
  };
  return { person, pages, calls, transport };
}
