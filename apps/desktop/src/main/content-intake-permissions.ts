import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { IntakePermissionCommand, IntakePermissionView } from '../shared/content-intake-permissions';
import { isDefinitiveRollback } from '../shared/content-intake-recovery';
import { loadIntakeAccess } from './content-intake-access';
import type { IntakeUsageSession } from './content-intake-usage';
import { ProductHttpError } from './product-http';
type C = components['schemas'];
type Source = { selection: string; source: C['IntakeSource']; actions: C['IntakeAction'][] };
type Person = C['IntakePrincipalPage']['items'][number] & { selection: string; deadline: number };
type Pending = { path: string; method: 'POST' | 'PATCH'; body: C['IntakeGrantBatch'] | C['IntakeGrantChange']; uncertain: boolean };
const reject = () => { throw new ProductHttpError('STALE'); };
// IntakeScope has ids, not names. A missing name stays 该店铺 / 该来源, and the id never becomes the label.
const label = (s: C['IntakeScope']) => `该店铺 · ${{product:'产品',campaign:'活动',presale:'售前',aftersale:'售后'}[s.domain]} · 该来源`;

/** Owns ephemeral selections, credential epochs and exact mutation recovery.
 * Renderer supplies intent; it never receives IDs to construct a grant request. */
export class ContentIntakePermissions {
  private access: Awaited<ReturnType<typeof loadIntakeAccess>> | null = null;
  private sources: Source[] = [];
  private selected: Source | null = null;
  private people: Person[] = [];
  private grants: { selection: string; grant: C['IntakeGrant'] }[] = [];
  private preview: C['IntakeGrantBatch'] | null = null;
  private previewView: IntakePermissionView['preview'] = null;
  private pending: Pending | null = null;
  private active: AbortController | null = null;
  private generation = 0;
  private epoch: number;
  private deadline = 0;
  private disposed = false;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private previewDeadline = 0;
  private notice: string | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(private readonly session: IntakeUsageSession) {
    this.epoch = session.view().sessionEpoch;
    this.unsubscribe = session.subscribe(() => {
      const view = session.view();
      if (view.sessionEpoch !== this.epoch || !view.signedIn) {
        this.epoch = view.sessionEpoch; this.stop(); this.clear(); this.pending = null;
        this.notice = '会话已变化；请重新读取权限。未确认的服务端操作请核对授权列表。'; this.emit();
      }
    });
  }
  private emit() { for (const fn of this.listeners) fn(); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private armExpiry() {
    if(this.expiry)clearTimeout(this.expiry);
    const deadlines=[this.deadline,...this.people.map(p=>p.deadline)].filter(d=>d>performance.now());
    if(!deadlines.length)return;
    this.expiry=setTimeout(()=>{
      this.people=this.people.filter(p=>this.personFresh(p));
      if(performance.now()>=this.previewDeadline){this.preview=null;this.previewView=null;}
      this.emit();this.armExpiry();
    },Math.min(2_147_483_647,Math.max(1,Math.min(...deadlines)-performance.now()+1)));
  }
  private personFresh(p:Person) { return Date.now()<Date.parse(p.validUntil) && performance.now()<p.deadline; }
  private clear() { if(this.expiry)clearTimeout(this.expiry);this.expiry=null; this.access=null; this.sources=[]; this.selected=null; this.people=[]; this.grants=[]; this.preview=null; this.previewView=null; this.deadline=0; }
  private fresh() { return !!this.access && Date.now()<Date.parse(this.access.validUntil) && performance.now()<this.deadline; }
  closeRisk() { return !!this.pending || !!this.preview || !!this.active; }
  view(): IntakePermissionView {
    const fresh = this.fresh(), named = this.people.filter(p=>this.personFresh(p));
    const names = new Map(named.map(p=>[p.principalId,p.displayLabel]));
    const selections = new Map(named.map(p=>[p.principalId,p.selection]));
    return { signedIn:this.session.view().signedIn,available:fresh && this.sources.length>0,busy:!!this.active,
      validUntil:fresh ? this.access!.validUntil:null,sources:fresh?this.sources.map(s=>({selection:s.selection,label:label(s.source.scope)})):[],
      source:fresh?this.selected?.selection??null:null,people:fresh?named.map(p=>({selection:p.selection,label:p.displayLabel})):[],
      actions:fresh?this.selected?.actions??[]:[],grants:fresh?this.grants.map(({selection,grant:g})=>({selection,reference:g.grantId,startsAt:g.startsAt,reason:g.reason,
        person:names.get(g.recipientPrincipalId)??'当前姓名不可用',personSelection:selections.get(g.recipientPrincipalId)??null,action:g.action,scope:label(g.scope),expiresAt:g.expiresAt,
        revoked:g.revokedAt!==null,canRevoke:g.kind==='business' && g.revokedAt===null})):[],
      preview:fresh && performance.now()<this.previewDeadline?this.previewView:null,pending:!!this.pending,
      resultUnknown:!!this.pending && (this.pending.uncertain || !!this.active),notice:this.notice };
  }
  private stop() {
    // A stopped write may already have committed; its stale response cannot
    // settle the original operation before a later qualification rejection.
    if (this.active && this.pending) this.pending.uncertain=true;
    this.generation++; this.active?.abort(); this.active=null;
  }
  dispose() { this.disposed=true; this.stop(); this.clear(); this.pending=null; this.unsubscribe(); this.listeners.clear(); }
  async command(command: IntakePermissionCommand): Promise<IntakePermissionView> {
    if (command.action==='stop') { this.stop(); this.preview=null; this.previewView=null; this.notice=this.pending?'已停止本机等待；服务端结果仍须按原请求确认。':'已停止读取。'; return this.view(); }
    if (this.active || this.disposed || !this.session.view().signedIn) return reject();
    if (this.pending && command.action!=='retry') throw new ProductHttpError('CONFLICT');
    if (command.action==='retry' && !this.pending) throw new ProductHttpError('CONFLICT');
    if (command.action==='discard') { this.preview=null;this.previewView=null;return this.view(); }
    const controller = new AbortController(), gen=++this.generation, epoch=this.session.view().sessionEpoch;
    this.active=controller; this.notice=null;
    const check=()=>{if(this.disposed || gen!==this.generation || controller.signal.aborted || !this.session.view().signedIn || this.session.view().sessionEpoch!==epoch) reject();};
    const request=async(path:string, options: {method?:'POST'|'PATCH';body?:unknown}={})=>{
      check();const response=await this.session.request(epoch,path,{...options,signal:controller.signal,maxResponseBytes:262144});check();return response.value;
    };
    // Each endpoint's cursor can yield empty filtered pages; bounds apply to
    // all pages, and a repeated cursor is rejected before issuing another read.
    const pages=async(schema:'IntakeGrantList'|'IntakePrincipalPage',path:string)=>{
      const items: unknown[]=[];const seen=new Set<string>();let cursor:string|null=null,bytes=0;
      do {if(seen.size>=50) throw new ProductHttpError('OVERLOADED');
        const raw=await request(`${path}${path.includes('?')?'&':'?'}limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
        bytes+=Buffer.byteLength(JSON.stringify(raw));if(bytes>8*1024*1024) throw new ProductHttpError('OVERLOADED');
        const page=parseContractSchema(schema,raw);items.push(...page.items);cursor=page.nextCursor;
        if(cursor){if(seen.has(cursor))return reject();seen.add(cursor);}
      }while(cursor);return items;
    };
    const readSelected=async()=>{
      this.people=[];this.grants=[];
      if(!this.selected)return;
      const people=await pages('IntakePrincipalPage',`/v1/intake/principals?sourceId=${encodeURIComponent(this.selected.source.scope.sourceId)}&purpose=grant-recipient`) as C['IntakePrincipalPage']['items'];
      if(new Set(people.map(p=>p.principalId)).size!==people.length || people.some(p=>!p.enabled || Date.parse(p.validUntil)<=Date.now()))return reject();
      this.people=people.map(p=>({...p,selection:randomUUID(),deadline:performance.now()+Math.max(0,Date.parse(p.validUntil)-Date.now())}));
      const grants=await pages('IntakeGrantList','/v1/intake/grants') as C['IntakeGrant'][];
      if(new Set(grants.map(g=>g.grantId)).size!==grants.length)return reject();
      const scope=this.selected.source.scope;
      this.grants=grants.filter(g=>g.kind==='business' && g.scope.tenantId===scope.tenantId && g.scope.appId===scope.appId && g.scope.brandId===scope.brandId
        && g.scope.shopId===scope.shopId && g.scope.domain===scope.domain && (g.scope.sourceId===null || g.scope.sourceId===scope.sourceId)).map(grant=>({selection:randomUUID(),grant}));
      if(!this.fresh())return reject();this.armExpiry();
    };
    const write=async()=>{
      const pending=this.pending;
      if(!pending)return reject();
      try {const raw=await request(pending.path,{method:pending.method,body:pending.body});
        parseContractSchema(pending.method==='POST'?'IntakeGrantList':'IntakeGrant',raw);this.pending=null;this.preview=null;this.previewView=null;
        this.notice='本次操作已保存。请刷新列表查看当前权限；此回执不代表权限永久有效。';
        this.clear();
      }catch(error){
        // Only the current attempt may settle recovery. An aborted/old-session
        // failure can arrive after a retry or a new session has started writing.
        check();
        // A transport/cancellation/malformed response cannot prove no COMMIT.
        const definitive = error instanceof ProductHttpError && isDefinitiveRollback(error.code,error.reason);
        if(definitive && !pending.uncertain)this.pending=null;
        else {
          // A later qualification rejection cannot settle an earlier unknown COMMIT.
          pending.uncertain=true;
          if(definitive)this.notice='先前操作结果仍未确认；当前资格已拒绝重试。请由有权人员核对授权列表，资格恢复后仍使用原请求确认。';
        }
        throw error;
      }
    };
    try {
      if(command.action==='retry') {await write();}
      else if(command.action==='refresh') {
        this.clear();const access=await loadIntakeAccess(this.session,controller.signal);check();this.access=access;
        this.deadline=performance.now()+Math.max(0,Date.parse(access.validUntil)-Date.now());this.armExpiry();
        this.sources=access.sources.flatMap(source=>{const c=access.capabilities.find(c=>c.scope.sourceId===source.scope.sourceId)!;
          const actions=c.mayAllocate.filter(a=>a!=='review');return actions.length?[{source,actions,selection:randomUUID()}]:[];});
        if(this.sources.length===1){this.selected=this.sources[0]!;await readSelected();}
      }else{
        if(!this.fresh())return reject();
        if(command.action==='source') {this.selected=this.sources.find(s=>s.selection===command.selection)??null;this.preview=null;this.previewView=null;if(!this.selected)return reject();await readSelected();}
        if(command.action==='preview') {
          this.preview=null;this.previewView=null;
          const person=this.people.find(p=>p.selection===command.person), selected=this.selected;
          if(!person || !selected || !this.personFresh(person) || command.actions.some(a=>!selected.actions.includes(a)))return reject();
          const body=parseContractSchema('IntakeGrantBatch',{operationId:randomUUID(),issuerFactsVersion:this.access!.factsVersion,policyVersion:this.access!.policyVersion,
            items:command.actions.map(action=>({kind:'business',recipientPrincipalId:person.principalId,recipientFactsVersion:person.factsVersion,action,scope:selected.source.scope,
              startsAt:command.startsAt,expiresAt:command.expiresAt,reason:command.reason}))});
          parseContractSchema('IntakeGrantList',await request('/v1/intake/grants/preview',{method:'POST',body}));
          if(!this.fresh())return reject();this.preview=body;this.previewDeadline=Math.min(this.deadline,person.deadline);this.armExpiry();this.previewView={person:person.displayLabel,actions:command.actions,scope:label(selected.source.scope),startsAt:command.startsAt,expiresAt:command.expiresAt,reason:command.reason};
        }
        if(command.action==='save') {if(!this.preview || performance.now()>=this.previewDeadline)return reject();this.pending={path:'/v1/intake/grants',method:'POST',body:this.preview,uncertain:false};await write();}
        if(command.action==='revoke') {
          const selected=this.grants.find(g=>g.selection===command.selection);
          if(!selected || !this.view().grants.find(g=>g.selection===command.selection)?.canRevoke)return reject();
          this.pending={path:`/v1/intake/grants/${encodeURIComponent(selected.grant.grantId)}`,method:'PATCH',body:parseContractSchema('IntakeGrantChange',{
            operationId:randomUUID(),expectedVersion:selected.grant.version,change:'revoke',stewardPrincipalId:null,reason:command.reason}),uncertain:false};await write();
        }
      }
      check();this.active=null;return this.view();
    }finally{if(this.active===controller)this.active=null;controller.abort();this.emit();}
  }
}
