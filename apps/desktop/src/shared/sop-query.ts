/** Independent SOP query wire contract. Main validates it before projection;
 * no session credential or preview handle belongs in the renderer model. */
export const SOP_QUERY_CONTRACT = 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b';
export const SOP_QUERY_GROUPS = ['过敏流程SOP', '长痘痘SOP', '品质售后SOP', '少错破SOP', '税收相关规则'] as const;
export type SopQueryGroup = typeof SOP_QUERY_GROUPS[number];
export type SopQueryGraph = {
  entry_node_id: string;
  nodes: { node_id: string; scenario_id: string; sequence: number; kind: 'instruction' | 'decision' | 'terminal'; terminal: boolean; source_ref: string }[];
  branches: { branch_id: string; source_node_id: string; option: string; target_node_id: string | null; is_unresolved: boolean }[];
  messages: { message_id: string; node_id: string; title: string; body: string; risk_level: 'unclassified' | 'low' | 'medium' | 'high' | 'critical'; copy_allowed: boolean }[];
  media_refs: { media_id: string; node_id: string; content_type: 'image/png' | 'image/jpeg' | 'image/gif'; preview_handle: string; expires_at: string }[];
};
export type SopQueryResponse =
  | { status: 'ready'; request_id: string; release_id: string; lease_expires_at: string; result: SopQueryGraph; reasons: [] }
  | { status: 'no_match'; request_id: string; release_id: string; lease_expires_at: string; result: { nodes: []; branches: []; messages: []; media_refs: [] }; reasons: [] }
  | { status: 'blocked'; request_id: string; release_id: null; lease_expires_at: null; result: null; reasons: { code: string; source_ref?: string }[] }
  | { status: 'stale'; request_id: string; release_id: string | null; lease_expires_at: null; result: null; reasons: { code: string; source_ref?: string }[] };

export type SopQueryProjection = {
  projectionVersion: 'sop-query-v1';
  sessionId: number;
  state: 'idle' | 'loading' | 'ready' | 'blocked' | 'stale' | 'no_match' | 'failed';
  shops: { key: string; label: string }[];
  notice: string;
  messages: { key: string; title: string; body: string; risk: string; canCopy: boolean }[];
  branches: { key: string; label: string }[];
  terminal: boolean;
  copied: boolean;
};
export type SopQueryCommand =
  | { kind: 'clear' }
  | { kind: 'query'; shopKey: string; group: SopQueryGroup; text: string }
  | { kind: 'choose' | 'copy'; key: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).every(k => names.includes(k));
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const array = (v: unknown, max: number, check: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(check);
export function isSopQueryCommand(v: unknown): v is SopQueryCommand {
  if (!record(v)) return false;
  if (v.kind === 'clear') return Object.keys(v).length === 1;
  if (v.kind === 'query') return keys(v, ['kind','shopKey','group','text']) && text(v.shopKey,128) && SOP_QUERY_GROUPS.includes(v.group as SopQueryGroup) && text(v.text,2048) && /\S/.test(v.text);
  return (v.kind === 'choose' || v.kind === 'copy') && keys(v,['kind','key']) && text(v.key,128);
}
export function isSopQueryResponse(v: unknown): v is SopQueryResponse {
  if (!record(v) || !keys(v,['status','request_id','release_id','lease_expires_at','result','reasons'])
    || typeof v.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.request_id)
    || !Array.isArray(v.reasons)) return false;
  if (v.status === 'blocked' || v.status === 'stale') return v.lease_expires_at === null && v.result === null
    && (v.status === 'blocked' ? v.release_id === null : v.release_id === null || text(v.release_id,256))
    && v.reasons.length > 0 && array(v.reasons,8,r => record(r) && keys(r,['code','source_ref'])
      && ['SCOPE_DENIED','LEASE_EXPIRED','APPROVAL_REVOKED','SOURCE_GATE_NOT_READY','GRAPH_UNRESOLVED','TERMINAL_HAS_OUTGOING_EDGE','SAFETY_REVIEW_REQUIRED','MEDIA_UNVERIFIED','STALE_RELEASE','IDEMPOTENCY_CONFLICT'].includes(String(r.code)) && (r.source_ref === undefined || text(r.source_ref,512)));
  if (!text(v.release_id,256) || !date(v.lease_expires_at) || v.reasons.length !== 0 || !record(v.result)) return false;
  const g = v.result;
  if (v.status === 'no_match') return keys(g,['nodes','branches','messages','media_refs']) && [g.nodes,g.branches,g.messages,g.media_refs].every(x => Array.isArray(x) && x.length === 0);
  return v.status === 'ready' && keys(g,['entry_node_id','nodes','branches','messages','media_refs']) && text(g.entry_node_id,256)
    && array(g.nodes,128,n => record(n) && keys(n,['node_id','scenario_id','sequence','kind','terminal','source_ref']) && text(n.node_id,256) && text(n.scenario_id,128) && Number.isSafeInteger(n.sequence) && Number(n.sequence)>=0 && Number(n.sequence)<=10000 && ['instruction','decision','terminal'].includes(String(n.kind)) && typeof n.terminal==='boolean' && text(n.source_ref,512))
    && array(g.branches,512,b => record(b) && keys(b,['branch_id','source_node_id','option','target_node_id','is_unresolved']) && text(b.branch_id,256) && text(b.source_node_id,256) && text(b.option,512) && (b.target_node_id===null || text(b.target_node_id,256)) && typeof b.is_unresolved==='boolean')
    && array(g.messages,256,m => record(m) && keys(m,['message_id','node_id','title','body','risk_level','copy_allowed']) && text(m.message_id,256) && text(m.node_id,256) && text(m.title,512) && text(m.body,8192) && ['unclassified','low','medium','high','critical'].includes(String(m.risk_level)) && typeof m.copy_allowed==='boolean')
    && array(g.media_refs,500,m => record(m) && keys(m,['media_id','node_id','content_type','preview_handle','expires_at']) && text(m.media_id,256) && text(m.node_id,256) && ['image/png','image/jpeg','image/gif'].includes(String(m.content_type)) && text(m.preview_handle,512) && date(m.expires_at));
}
/** IPC boundary validation rejects payloads carrying extra identity or network fields. */
export function isSopQueryProjection(v: unknown): v is SopQueryProjection {
  return record(v) && keys(v,['projectionVersion','sessionId','state','shops','notice','messages','branches','terminal','copied'])
    && v.projectionVersion==='sop-query-v1' && Number.isSafeInteger(v.sessionId) && Number(v.sessionId)>0
    && ['idle','loading','ready','blocked','stale','no_match','failed'].includes(String(v.state)) && typeof v.notice==='string'
    && array(v.shops,1000,s => record(s) && keys(s,['key','label']) && text(s.key,128) && text(s.label,512))
    && array(v.messages,256,m => record(m) && keys(m,['key','title','body','risk','canCopy']) && text(m.key,128) && text(m.title,512) && text(m.body,8192) && ['unclassified','low','medium','high','critical'].includes(String(m.risk)) && typeof m.canCopy==='boolean')
    && array(v.branches,512,b => record(b) && keys(b,['key','label']) && text(b.key,128) && text(b.label,512))
    && typeof v.terminal==='boolean' && typeof v.copied==='boolean'
    && (v.state==='ready' || (Array.isArray(v.messages) && v.messages.length===0 && Array.isArray(v.branches) && v.branches.length===0 && !v.terminal && !v.copied));
}
