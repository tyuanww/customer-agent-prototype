import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SOP_QUERY_CONTRACT, isSopQueryResponse, type SopQueryCommand, type SopQueryGraph, type SopQueryProjection, type SopQueryResponse } from '../shared/sop-query';
import type { ProductSession } from './product-session';
import { loadIntakeAccess } from './content-intake-access';
import { SOP_COPY_FEEDBACK_MS } from '../shared/sop-geometry';
import { ProductHttpError } from './product-http';

type Session = Pick<ProductSession, 'view' | 'request' | 'subscribe'>;
type Ready = Extract<SopQueryResponse, { status: 'ready' }>;
type ActiveSopQuery = { response: Ready; input: { sop_group: string; shop_id: string; query_text: string; context_generation: string }; node: string; deadline: number; epoch: number };

/** Explicit graph edges are the only progression authority. Sequence is display
 * metadata and never supplies a missing edge. */
export function executableSopGraph(g: SopQueryGraph): boolean {
  if (g.messages.some(message => message.risk_level === 'unclassified'
    || ((message.title.includes('过敏') || message.body.includes('过敏'))
      && (!message.body.includes('停手') || !message.body.includes('确认'))))) return false;
  const ids = new Set(g.nodes.map(n => n.node_id));
  if (ids.size !== g.nodes.length || !ids.has(g.entry_node_id)
    || new Set(g.branches.map(b => b.branch_id)).size !== g.branches.length
    || new Set(g.messages.map(m => m.message_id)).size !== g.messages.length
    || new Set(g.media_refs.map(m => m.media_id)).size !== g.media_refs.length
    || g.messages.some(m => !ids.has(m.node_id)) || g.media_refs.some(m => !ids.has(m.node_id))
    || g.branches.some(b => b.is_unresolved || !ids.has(b.source_node_id) || b.target_node_id === null || !ids.has(b.target_node_id))) return false;
  for (const node of g.nodes) {
    const outgoing = g.branches.filter(b => b.source_node_id === node.node_id);
    if (node.terminal !== (node.kind === 'terminal')
      || (node.terminal && outgoing.length !== 0)
      || (node.kind === 'instruction' && outgoing.length !== 1)
      || (node.kind === 'decision' && (outgoing.length < 2 || outgoing.length > 4))) return false;
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const edge of g.branches.filter(b => b.source_node_id === id)) if (!visit(edge.target_node_id!)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  return visit(g.entry_node_id) && visited.size === ids.size;
}

/** Owns the query's context, deadlines and opaque action handles. Every action
 * re-reads the same query through the authenticated session. A re-read may only
 * confirm the original graph; it cannot extend its lease or replace its release. */
export class SopQueryRuntime {
  private projectionValue: SopQueryProjection = { projectionVersion: 'sop-query-v1', sessionId: 1, state: 'idle', shops: [], notice: '选择店铺和流程后查询。', messages: [], branches: [], terminal: false, copied: false };
  private shops = new Map<string, string>();
  private handles = new Map<string, { kind: 'copy' | 'choose'; id: string }>();
  private active: ActiveSopQuery | null = null;
  private generation = 0;
  private operation: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch: number;
  private readonly unsubscribe: () => void;
  private listeners = new Set<() => void>();
  constructor(private readonly session: Session, private readonly writeClipboard: (text: string) => void) {
    this.epoch = session.view().sessionEpoch;
    this.unsubscribe = session.subscribe(() => {
      const view = session.view();
      if (!view.signedIn || view.sessionEpoch !== this.epoch) {
        this.epoch = view.sessionEpoch; this.shops.clear(); this.projectionValue.shops = [];
        this.invalidate('登录状态已变化，请重新打开流程。');
      }
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  projection() { return structuredClone(this.projectionValue); }
  private emit() { for (const listener of this.listeners) listener(); }
  invalidate(notice = '查询条件已变化，请重新查询。') {
    this.generation++; this.operation?.abort(); this.operation = null; this.active = null; this.handles.clear();
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.copyTimer) clearTimeout(this.copyTimer); this.copyTimer = null;
    this.projectionValue = { ...this.projectionValue, state: 'stale', notice, messages: [], branches: [], terminal: false, copied: false };
    this.emit();
  }
  async open(sessionId: number) {
    if (sessionId === this.projectionValue.sessionId && this.shops.size > 0) return;
    this.invalidate(); this.shops.clear(); this.projectionValue.shops = []; this.projectionValue.sessionId = sessionId;
    this.projectionValue.state = 'loading'; this.projectionValue.notice = '正在读取可用店铺。'; this.emit();
    const generation = this.generation, operation = new AbortController(); this.operation = operation;
    try {
      const access = await loadIntakeAccess(this.session, operation.signal);
      if (generation !== this.generation || operation.signal.aborted) return;
      if (access.shops.length > 1000) throw new Error('SOP_SHOP_LIMIT');
      this.shops.clear();
      this.projectionValue.shops = access.shops.map(id => {
        const key = randomUUID(); this.shops.set(key,id);
        return { key, label: id };
      });
      this.projectionValue.state = 'idle'; this.projectionValue.notice = '选择店铺和流程后查询。'; this.emit();
    } catch { if (generation === this.generation) this.fail('无法读取店铺，请重新打开流程。'); }
    finally { if (this.operation === operation) this.operation = null; }
  }
  private fail(notice: string, state: SopQueryProjection['state'] = 'failed') {
    this.invalidate(notice); this.projectionValue.state = state; this.emit();
  }
  private async read(input: ActiveSopQuery['input'], epoch: number, signal: AbortSignal): Promise<SopQueryResponse> {
    const requestId = randomUUID();
    const { value } = await this.session.request(epoch, '/v1/sop/query', {
      body: { ...input, request_id: requestId }, signal, timeoutMs: 5000, maxResponseBytes: 4 * 1024 * 1024,
      headers: { 'x-intake-contract-set': SOP_QUERY_CONTRACT },
    });
    if (!isSopQueryResponse(value) || value.request_id !== requestId) throw new Error('SOP_WIRE_INVALID');
    return value;
  }
  private acceptFailure(response: SopQueryResponse): boolean {
    if (response.status === 'ready') return false;
    this.fail(response.status === 'blocked' ? '当前流程不能安全提供，请联系管理员核对。'
      : response.status === 'stale' ? '流程已失效，请重新查询。' : '没有找到匹配流程。', response.status);
    return true;
  }
  private render() {
    const active = this.active; if (!active) return;
    const graph = active.response.result;
    this.handles.clear();
    this.projectionValue = { ...this.projectionValue, state: 'ready', notice: '', copied: false,
      messages: graph.messages.filter(m => m.node_id === active.node).map(m => {
        const key = randomUUID(); this.handles.set(key, { kind:'copy', id:m.message_id });
        return { key, title:m.title, body:m.body, risk:m.risk_level, canCopy:m.copy_allowed && graph.nodes.find(n=>n.node_id===active.node)?.kind !== 'decision' };
      }),
      branches: graph.branches.filter(b=>b.source_node_id===active.node).map(b=> {
        const key=randomUUID(); this.handles.set(key,{kind:'choose',id:b.branch_id}); return {key,label:b.option};
      }), terminal:graph.nodes.find(n=>n.node_id===active.node)!.terminal,
    };
    this.emit();
  }
  async command(command: SopQueryCommand): Promise<{ ok: boolean }> {
    if (command.kind === 'clear') { this.invalidate(); return {ok:true}; }
    if (command.kind === 'query') return this.query(command);
    if (this.operation || !this.active) return { ok:false };
    const handle = this.handles.get(command.key), active = this.active;
    if (!handle || handle.kind !== command.kind) return {ok:false};
    const generation=this.generation, operation=new AbortController(); this.operation=operation;
    try {
      const response=await this.read(active.input,active.epoch,operation.signal);
      if (generation!==this.generation || operation.signal.aborted) return {ok:false};
      if (this.acceptFailure(response)) return {ok:false};
      if (response.status !== 'ready' || Date.now()>=Date.parse(active.response.lease_expires_at)
        || performance.now()>=active.deadline || Date.now()>=Date.parse(response.lease_expires_at)
        || response.release_id!==active.response.release_id || !isDeepStrictEqual(response.result,active.response.result)) {
        this.fail('流程或使用期限已变化，请重新查询。','stale'); return {ok:false};
      }
      if (command.kind==='choose') {
        const edge=response.result.branches.find(b=>b.branch_id===handle.id && b.source_node_id===active.node);
        if (!edge?.target_node_id) return {ok:false};
        active.node=edge.target_node_id; this.render();
      } else {
        const message=response.result.messages.find(m=>m.message_id===handle.id && m.node_id===active.node);
        if (!message?.copy_allowed || response.result.nodes.find(n=>n.node_id===active.node)?.kind==='decision') return {ok:false};
        this.writeClipboard(message.body); this.projectionValue.copied=true; this.emit();
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer=setTimeout(()=> {this.projectionValue.copied=false;this.emit();},SOP_COPY_FEEDBACK_MS);
      }
      return {ok:true};
    } catch (error) {
      if (generation===this.generation) this.fail(error instanceof ProductHttpError && ['FORBIDDEN','UNAUTHORIZED'].includes(error.code) ? '当前流程权限已失效，请重新查询。' : '流程校验失败，请重新查询。', 'stale');
      return {ok:false};
    } finally { if (this.operation===operation) this.operation=null; }
  }
  private async query(command: Extract<SopQueryCommand,{kind:'query'}>): Promise<{ok:boolean}> {
    const shopId=this.shops.get(command.shopKey);
    this.invalidate();
    if (!shopId || !this.session.view().signedIn) {this.fail('请选择可用店铺并登录。','blocked');return {ok:false};}
    const generation=this.generation, operation=new AbortController(); this.operation=operation;
    this.projectionValue.state='loading';this.projectionValue.notice='正在查询流程。';this.emit();
    const input={sop_group:command.group,shop_id:shopId,query_text:command.text,context_generation:randomUUID()};
    const epoch=this.session.view().sessionEpoch, started=performance.now();
    try {
      const response=await this.read(input,epoch,operation.signal);
      if (generation!==this.generation || operation.signal.aborted) return {ok:false};
      if (this.acceptFailure(response)) return {ok:true};
      if (response.status!=='ready') return {ok:false};
      if (!executableSopGraph(response.result)) {this.fail('流程结构不完整，不能继续。','blocked');return {ok:false};}
      if (response.result.media_refs.length) {this.fail('当前流程的图片暂不可用，请联系管理员核对。','blocked');return {ok:false};}
      const remaining=Math.min(Date.parse(response.lease_expires_at)-Date.now(),30000-(performance.now()-started));
      if (remaining<=0) {this.fail('流程使用期限已结束，请重新查询。','stale');return {ok:false};}
      this.active={response,input,node:response.result.entry_node_id,deadline:performance.now()+remaining,epoch};
      this.timer=setTimeout(()=>this.invalidate('流程使用期限已结束，请重新查询。'),remaining);
      this.render();return {ok:true};
    } catch { if(generation===this.generation) this.fail('查询失败，请重试。'); return {ok:false}; }
    finally {if(this.operation===operation)this.operation=null;}
  }
  dispose() {this.invalidate();this.unsubscribe();this.listeners.clear();}
}
