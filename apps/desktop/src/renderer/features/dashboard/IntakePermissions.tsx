import { Button, Empty, Input, Modal, Select, Table, type ButtonProps, type TableColumnsType, type TableProps } from 'antd';
import { createElement, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import './workbench-v9.css';
import { INTAKE_PERMISSION_ACTION_LABELS as labels, type IntakePermissionCommand, type IntakePermissionReply, type IntakePermissionView } from '@shared/content-intake-permissions';
import { type AsyncResource } from '@shared/async-resource';
import { actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS, intakePostStatusForGrants, intakePostsCoveredBy, isIntakePost, type IntakePost } from '@shared/intake-post-actions';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import type { SeatAccountIntent, SeatAccountRecord, SeatAccountReply } from '@shared/seat-account-intent';
import { formatSeatClock, timeoutUntil } from './intake-time';
import { IntakeAntdTheme } from './intake-antd';
import { SeatDateTime } from './seat-date-time';
import { useAsyncResource } from './use-async-resource';
import { WorkbenchFailed, WorkbenchLoading, WorkbenchNoAccess, WorkbenchUncertain } from './WorkbenchState';
import type { AccessBlock } from '@shared/workbench-access';

function DeskButton(props: ButtonProps) {
  return <Button {...props} autoInsertSpace={false} />;
}

function PermissionsEmpty({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

/** rc-table copies aria-label onto the table. antd's prop type omits it. */
function A11yTable<RecordType extends object>(props: TableProps<RecordType> & { 'aria-label': string }) {
  return createElement(Table as ComponentType<typeof props>, props);
}

type PeopleRow = { key: string; label: string; post: string; status: string };
type GrantRow = IntakePermissionView['grants'][number];

const peopleColumns: TableColumnsType<PeopleRow> = [
  { title: '姓名', dataIndex: 'label', key: 'label' },
  { title: '登录名', key: 'login', render: () => '—' },
  { title: '岗位', dataIndex: 'post', key: 'post' },
  { title: '状态', dataIndex: 'status', key: 'status', render: (status: PeopleRow['status']) => <span className="state"><i className={`dot${status === '已授权' ? ' ok' : ''}`} />{status}</span> },
];

function SeatAccounts({ disabled, createOpen, setCreateOpen }: { disabled: boolean; createOpen: boolean; setCreateOpen: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [post, setPost] = useState<IntakePost>(DEFAULT_INTAKE_POST);
  const [rows, setRows] = useState<SeatAccountRecord[]>([]);
  const [resetting, setResetting] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [disabling, setDisabling] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const flight = useRef(false);
  const listGeneration = useRef(0);
  const blocked = disabled || busy;
  const send = async (intent: SeatAccountIntent): Promise<SeatAccountReply | null> => {
    const api = window.dashboardSeats;
    if (!api) { setProblem('账号暂不可用。'); return null; }
    if (flight.current) return null;
    flight.current = true;
    setBusy(true); setProblem('');
    try {
      const reply = await api.command(intent);
      if (!reply.ok) { setProblem(reply.message); return null; }
      return reply;
    } catch {
      setProblem('账号暂不可用。');
      return null;
    } finally { flight.current = false; setBusy(false); }
  };
  const create = async () => {
    const reply = await send({ action: 'create', displayName: name.trim(), username: username.trim(), password, post });
    if (reply === null || !reply.ok || reply.action !== 'create') return;
    setName(''); setUsername(''); setPassword(''); setPost(DEFAULT_INTAKE_POST); setCreateOpen(false);
    refreshSeats();
  };
  const reset = async (login: string) => {
    const reply = await send({ action: 'reset', username: login, password: nextPassword });
    if (reply === null || !reply.ok || reply.action !== 'reset') return;
    setNextPassword(''); setResetting('');
  };
  const closeReset = () => { setResetting(''); setNextPassword(''); };
  const disable = async (login: string) => {
    const reply = await send({ action: 'disable', username: login });
    if (reply === null || !reply.ok || reply.action !== 'disable') return;
    setDisabling('');
    refreshSeats();
  };
  const choose = (value: string) => {
    if (!isIntakePost(value)) { setProblem('请选择岗位。'); return; }
    setPost(value);
  };
  useEffect(() => {
    refreshSeats();
  }, []);
  const refreshSeats = () => {
    const api = window.dashboardSeats;
    if (!api) { setProblem('账号暂不可用。'); return; }
    const generation = ++listGeneration.current;
    void api.command({ action: 'list' }).then(reply => {
      if (generation !== listGeneration.current) return;
      if (!reply.ok) { setProblem(reply.message); return; }
      if (reply.action === 'list') setRows(reply.seats);
    }).catch(() => { setProblem('账号暂不可用。'); });
  };
  const closeAll = () => {
    setCreateOpen(false);
    setName('');
    setUsername('');
    setPassword('');
    setPost(DEFAULT_INTAKE_POST);
    closeReset();
    setDisabling('');
  };
  return <section>
    {problem && <p role="alert">{problem}</p>}
    <A11yTable<SeatAccountRecord>
      aria-label="外包坐席"
      pagination={false}
      rowKey="username"
      dataSource={rows}
      locale={{ emptyText: <PermissionsEmpty description="还没有外包坐席。" /> }}
      columns={[
        { title: '姓名', dataIndex: 'displayName' },
        { title: '登录名', dataIndex: 'username' },
        { title: '岗位', dataIndex: 'post' },
        { title: '状态', dataIndex: 'enabled', render: (enabled: boolean) => <span className="state"><i className={`dot${enabled ? ' ok' : ''}`} />{enabled ? '使用中' : '已停用'}</span> },
        { title: '操作', key: 'ops', width: 170, render: (_value, row) => row.enabled ? <div className="acts">
          <DeskButton type="text" disabled={blocked} onClick={() => { setResetting(row.username); setNextPassword(''); setDisabling(''); }}>重置密码</DeskButton>
          <DeskButton type="text" danger disabled={blocked} onClick={() => { setDisabling(row.username); closeReset(); }}>停用</DeskButton>
        </div> : null },
      ]}
    />
    <Modal open={createOpen} title="新建坐席" width={440} footer={null} destroyOnHidden transitionName="" maskTransitionName="" onCancel={closeAll}>
        <fieldset className="fields" disabled={blocked} style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <label>姓名<Input aria-label="姓名" autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
          <label>登录名<Input aria-label="登录名" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label>
          <label>密码<Input.Password aria-label="密码" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label>岗位<Select<IntakePost> aria-label="坐席岗位" value={post} disabled={blocked} virtual={false} style={{ width: '100%' }} options={INTAKE_POSTS.map(item => ({ value: item, label: item }))} onChange={choose} /></label>
        </fieldset>
        <footer><DeskButton onClick={closeAll}>取消</DeskButton>
          <DeskButton type="primary" disabled={blocked || !name.trim() || !username.trim() || password.length === 0} onClick={() => void create()}>保存坐席</DeskButton></footer>
    </Modal>
    <Modal open={resetting !== ''} title="重置密码" width={440} footer={null} destroyOnHidden onCancel={closeAll}>
        <div className="fields"><label>新密码<Input.Password aria-label="新密码" autoComplete="new-password" value={nextPassword} onChange={event => setNextPassword(event.target.value)} /></label></div>
        <footer><DeskButton disabled={blocked} onClick={closeAll}>取消</DeskButton>
          <DeskButton type="primary" disabled={blocked || nextPassword.length === 0} onClick={() => void reset(resetting)}>确认重置</DeskButton></footer>
    </Modal>
    <Modal open={disabling !== ''} title="停用坐席" closable={false} footer={null} destroyOnHidden onCancel={closeAll}>
      <p>停用后该账号无法再登录。</p>
      <footer>
        <DeskButton autoFocus disabled={blocked} onClick={closeAll}>取消</DeskButton>
        <DeskButton danger disabled={blocked} onClick={() => void disable(disabling)}>确认停用</DeskButton>
      </footer>
    </Modal>
  </section>;
}
const LOGGED_OUT = '请先登录。';
const READ_FAILED = '权限配置暂不可用，请重新读取。';

function resourceFromMissingApi(): AsyncResource<IntakePermissionView> {
  return { status: 'error', message: WORKBENCH_EMPTY.intakeUnmounted };
}

function resourceFromThrown(error: unknown): AsyncResource<IntakePermissionView> {
  const message: string = error instanceof Error && error.message === 'unmounted'
    ? WORKBENCH_EMPTY.intakeUnmounted
    : READ_FAILED;
  return { status: 'error', message };
}

function resourceFromReply(reply: IntakePermissionReply): { resource: AsyncResource<IntakePermissionView>; problem: string } {
  if (reply.ok && !reply.view.signedIn) return { resource: { status: 'forbidden', message: LOGGED_OUT }, problem: '' };
  if (!reply.ok && reply.view && !reply.view.signedIn) return { resource: { status: 'forbidden', message: LOGGED_OUT }, problem: '' };
  if (!reply.ok && reply.view) return { resource: { status: 'ready', value: reply.view }, problem: reply.message };
  if (!reply.ok && reply.message === LOGGED_OUT) return { resource: { status: 'forbidden', message: LOGGED_OUT }, problem: '' };
  if (!reply.ok) return { resource: { status: 'error', message: reply.message }, problem: '' };
  return { resource: { status: 'ready', value: reply.view }, problem: '' };
}

/** `grantAccess` is the display decision for the grant button, computed by the shell from the
 *  session job. `grantBlock` is the older single-sentence form, still accepted from callers that
 *  have not moved to the structured block. Neither decides access: the server still checks. */
export function IntakePermissions({ active, canGrant = false, grantBlock = '', grantAccess = null }: {
  active: boolean;
  canGrant?: boolean;
  grantBlock?: string;
  grantAccess?: AccessBlock | null;
}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [person,setPerson]=useState(''),[post,setPost]=useState<IntakePost>(DEFAULT_INTAKE_POST);
  const [starts,setStarts]=useState(''),[expires,setExpires]=useState(''),[reason,setReason]=useState('');
  const [revoke,setRevoke]=useState(''),[revokeReason,setRevokeReason]=useState('');
  const [job,setJob]=useState<'grants'|'seats'>('grants');
  const [grantOpen,setGrantOpen]=useState(false),[seatCreateOpen,setSeatCreateOpen]=useState(false);
  const [eligibilityEnded,setEligibilityEnded]=useState(false);
  const mounted=useRef(true),generation=useRef(0),pending=useRef(false);
  const allowReadRef=useRef(active);
  const [allowRead,setAllowRead]=useState(active);
  allowReadRef.current=allowRead;
  const resourceRef=useRef<AsyncResource<IntakePermissionView>>(active ? { status: 'loading' } : { status: 'idle' });
  const { resource, reload, replace } = useAsyncResource(async (): Promise<AsyncResource<IntakePermissionView>> => {
    if (!allowReadRef.current) return { status: 'idle' };
    const gen = generation.current;
    const api = window.dashboardPermissions;
    if (!api) return resourceFromMissingApi();
    try {
      const reply = await api.command({ action: 'refresh' });
      if (!mounted.current || gen !== generation.current) return resourceRef.current;
      const settled = resourceFromReply(reply);
      resourceRef.current = settled.resource;
      setError(settled.resource.status === 'ready' ? settled.problem : '');
      return settled.resource;
    } catch (caught) {
      if (!mounted.current || gen !== generation.current) return resourceRef.current;
      const failed = resourceFromThrown(caught);
      resourceRef.current = failed;
      setError('');
      return failed;
    }
  }, [allowRead], active ? { status: 'loading' } : { status: 'idle' }, { retainReady: true });
  resourceRef.current = resource;
  const view = resource.status === 'ready' ? resource.value : null;
  const apply = useCallback(async (command?: IntakePermissionCommand): Promise<boolean> => {
    if (pending.current && command?.action !== 'stop') return false;
    const gen = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    const replaceResource = (next: AsyncResource<IntakePermissionView>) => {
      resourceRef.current = next;
      replace(next);
    };
    try {
      const api = window.dashboardPermissions;
      if (!api) throw new Error('unmounted');
      const reply = await (command ? api.command(command) : api.current());
      if (gen !== generation.current) return false;
      const settled = resourceFromReply(reply);
      replaceResource(settled.resource);
      setError(settled.resource.status === 'ready' ? settled.problem : '');
      return reply.ok;
    } catch (caught) {
      if (gen === generation.current) {
        replaceResource(resourceFromThrown(caught));
        setError('');
      }
      return false;
    } finally {
      if (gen === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, [replace]);
  useEffect(()=>{
    // 切走再回来时页面仍挂着。再读一次会清掉还没保存的预览。
    if(active)setAllowRead(true);
  },[active]);
  useEffect(()=>{
    const api=window.dashboardPermissions;if(!api)return;
    return api.onInvalidated(()=>{if(!pending.current)void apply();});
  },[apply]);
  useEffect(()=>{setPerson('');setPost(DEFAULT_INTAKE_POST);setRevoke('');setRevokeReason('');},[view?.source]);
  useEffect(()=>{
    if(!view?.validUntil)return undefined;
    const until=Date.parse(view.validUntil);
    if(!Number.isFinite(until))return undefined;
    setEligibilityEnded(false);
    return timeoutUntil(()=>{setEligibilityEnded(true);void apply();},until);
  },[view?.validUntil, apply]);
  useEffect(()=>()=>{mounted.current=false;generation.current++;},[]);
  const disabled=busy || !!view?.busy || !!view?.pending;
  const readAgain=()=>{
    if(pending.current)return;
    // A later read must not replace the logged-out sentence with a loading flash.
    if(resource.status==='forbidden'){reload();return;}
    void apply({action:'refresh'});
  };
  const offered=intakePostsCoveredBy(view?.actions??[]);
  const chosen=offered.includes(post)?post:undefined;
  const previewPost=()=>{
    if(!chosen){setError('当前范围没有可授予的岗位。');return;}
    const mapped=actionsForIntakePost(chosen);
    if(!mapped.ok){setError('未知岗位。');return;}
    void apply({action:'preview',person,actions:[...mapped.actions],startsAt:new Date(starts).toISOString(),expiresAt:new Date(expires).toISOString(),reason});
  };
  const choosePost=(value:string)=>{
    if(!isIntakePost(value)){setError('未知岗位。');return;}
    setPost(value);
  };
  const closeGrant=()=>{
    if(!view?.preview){setGrantOpen(false);return;}
    void apply({action:'discard'}).then((ok)=>{if(ok)setGrantOpen(false);});
  };
  const askRevoke=()=>{
    const grant=view?.grants.find(item=>item.selection===revoke);
    if(!grant || !revokeReason.trim())return;
    // 收回后原授权不能恢复。取消只关掉这个框，原因留在表单里。
    Modal.confirm({
      title:`收回 ${grant.person} 在 ${grant.scope}的${labels[grant.action]}`,
      content:'收回之后不能撤销。以后要用，需要重新开通。',
      okText:'确认收回',
      cancelText:'取消',
      focusable:{autoFocusButton:'cancel'},
      okButtonProps:{danger:true,autoInsertSpace:false},
      cancelButtonProps:{autoInsertSpace:false},
      onOk:()=>apply({action:'revoke',selection:revoke,reason:revokeReason}),
      transitionName:'',
      maskTransitionName:'',
    });
  };
  const peopleRows=view?.source && view.people.length ? view.people.map(p=>{const grant=intakePostStatusForGrants(view.grants.filter(g=>g.personSelection===p.selection));return {key:p.selection,label:p.label,post:grant.post ?? '—',status:grant.status};}) : [];
  const grantColumns: TableColumnsType<GrantRow> = [
    { title: '人员', key: 'person', render: (_value, grant) => <>{grant.person}<span className="cell-sub">{labels[grant.action]}</span><span className="cell-sub">原授权原因：{grant.reason}</span></> },
    { title: '范围名称', dataIndex: 'scope', key: 'scope' },
    { title: '有效期', key: 'period', render: (_value, grant) => {
      const ended = !grant.revoked && Number.isFinite(Date.parse(grant.expiresAt)) && Date.parse(grant.expiresAt) <= Date.now();
      return <>{`${formatSeatClock(grant.startsAt)} 至 ${formatSeatClock(grant.expiresAt)}`}{grant.revoked ? <span className="state">已撤销</span> : ended ? <span className="state">已过期</span> : null}</>;
    } },
    { title: '操作', key: 'ops', width: 140, render: (_value, grant) => <DeskButton type="text" danger disabled={disabled || !grant.canRevoke || !!view?.preview} onClick={() => { setRevoke(grant.selection); setRevokeReason(''); }}>撤销该权限</DeskButton> },
  ];
  return <IntakeAntdTheme><div className="desk-permissions-page wb9"><section className="intake-management desk-permissions wb9" aria-label="权限配置">
    <h1 className="desk-sr">权限配置</h1>
    {resource.status === 'loading' ? <WorkbenchLoading rows={5} label="正在读取权限" /> : null}
    {resource.status === 'forbidden' ? <p>{resource.message}</p> : null}
    {resource.status === 'error' ? <WorkbenchFailed message={resource.message} onRetry={disabled ? undefined : readAgain} retryLabel="刷新权限列表" /> : null}
    {error && !grantOpen && <WorkbenchFailed message={error} onRetry={disabled ? undefined : readAgain} retryLabel="刷新权限列表" />}{view?.notice && <p role="status">{view.notice}</p>}
    {view?.pending && <WorkbenchUncertain
      message={view.resultUnknown ? '不确定授权是否已保存。请按原请求确认，不要重新开通；关闭窗口会丢失这次请求。' : '正在确认授权结果，请勿重复开通。'}
      checkLabel="按原请求确认结果"
      disabled={busy}
      onCheck={()=>void apply({action:'retry'})} />}
    {!view?.available && <div className="toolbar" style={{marginBottom:12}}><div className="left">
      <DeskButton disabled={disabled || !!view?.preview} onClick={readAgain}>刷新权限列表</DeskButton>
      {(busy || view?.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}</div></div>}
    {view && !view.signedIn && <p>请先登录。</p>}
    {view?.signedIn && !view.available && !view.pending && <p>{eligibilityEnded ? '登录状态需要确认。请刷新权限列表。' : '请刷新权限列表。'}</p>}
    {view?.available && <>
      <div className="tabbar"><div className="tabs intake-job-switch" role="tablist" aria-label="权限工作">
        <DeskButton type="text" className="tab" role="tab" aria-selected={job==='grants'} onClick={()=>setJob('grants')}>业务授权</DeskButton>
        <DeskButton type="text" className="tab" role="tab" aria-selected={job==='seats'} onClick={()=>{closeGrant();setJob('seats');}}>外包坐席</DeskButton>
      </div>
        <span className="row" style={{display:'inline-flex',gap:8,marginBottom:8}}>
          {(busy || view.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}
          {job==='grants'
            ? (canGrant
              ? <DeskButton type="primary" style={{marginBottom:0}} disabled={disabled || !view.source} onClick={()=>setGrantOpen(true)}>新增授权</DeskButton>
              : null)
            : <DeskButton type="primary" style={{marginBottom:0}} onClick={()=>setSeatCreateOpen(true)}>新建坐席</DeskButton>}
        </span>
      </div>
      {job==='grants' && grantAccess ? <WorkbenchNoAccess need={grantAccess.need} ask={grantAccess.ask} detail={grantAccess.detail} />
        : grantBlock ? <p role="status">{grantBlock}</p> : null}
      <div hidden={job!=='grants'}>
        <div className="sub"><label className="lbl" htmlFor="permissions-scope">配置范围</label>
          <Select<string> id="permissions-scope" aria-label="配置范围" style={{width:260}} disabled={disabled || !!view.preview} value={view.source ?? undefined} placeholder="请选择已有范围" virtual={false}
            options={view.sources.map(source => ({ value: source.selection, label: source.label }))} onChange={selection => { void apply({ action: 'source', selection }); }} />
          <DeskButton style={{marginLeft:8}} aria-label="刷新权限列表" disabled={disabled || !!view.preview} onClick={readAgain}>刷新</DeskButton></div>
        <A11yTable<PeopleRow> className="sub" aria-label="人员" pagination={false} rowKey="key" tableLayout="fixed" dataSource={peopleRows} columns={peopleColumns}
          locale={{ emptyText: <PermissionsEmpty description={view.source ? '当前没有可选择的人员。' : '请选择配置范围。'} /> }} />
        <div className="sec"><div className="sec-head"><h2>当前可管理的业务权限</h2></div>
          <section aria-label="已有业务权限">
          <A11yTable<GrantRow> aria-label="已有业务权限" pagination={false} rowKey="selection" tableLayout="fixed" dataSource={view.grants} columns={grantColumns}
            locale={{ emptyText: <PermissionsEmpty description="此范围暂无可管理业务权限。" /> }} />
          {revoke ? <fieldset disabled={disabled} style={{border:0,padding:0,margin:'12px 0 0'}}><div className="note-row"><span className="lbl">撤销原因</span>
            <Input aria-label="撤销原因" maxLength={512} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} />
            <DeskButton danger disabled={!revokeReason.trim()} onClick={askRevoke}>确认撤销</DeskButton>
            <DeskButton onClick={() => setRevoke('')}>取消</DeskButton></div></fieldset> : null}
          </section></div>
      </div>
      <div hidden={job!=='seats'}><SeatAccounts disabled={disabled} createOpen={seatCreateOpen} setCreateOpen={setSeatCreateOpen} /></div>
      <Modal open={grantOpen && view !== null} title={view?.preview ? '预览，尚未保存' : '新增业务权限'} width={520} footer={null} destroyOnHidden transitionName="" maskTransitionName="" onCancel={closeGrant}>
          {error ? <p role="alert">{error}</p> : null}
          {view && !view.preview ? <>
            <fieldset className="fields" disabled={disabled} style={{border:0,padding:0,margin:'12px 0 0'}}>
              <div className="two"><label>人员<Select<string> aria-label="人员" value={person || undefined} placeholder="请选择已确认人员" disabled={disabled} virtual={false} style={{ width: '100%' }}
                options={view.people.map(item => ({ value: item.selection, label: item.label }))} onChange={setPerson} /></label>
              <label>岗位<Select<string> aria-label="岗位" value={chosen} disabled={disabled || offered.length === 0} virtual={false} style={{ width: '100%' }}
                placeholder={offered.length === 0 ? '当前范围没有可授予的岗位' : '请选择岗位'} options={offered.map(name => ({ value: name, label: name }))} onChange={choosePost} /></label></div>
              <div className="two"><label>生效时间<SeatDateTime label="生效时间" placeholder="选择生效时间" value={starts} onChange={setStarts} disabled={disabled} /></label>
              <label>失效时间<SeatDateTime label="失效时间" placeholder="选择失效时间" value={expires} onChange={setExpires} disabled={disabled} /></label></div>
              <span className="hint">时间按本机时区填写，范围和期限仍由服务器核对。</span>
              <label>授权原因<Input aria-label="授权原因" maxLength={512} value={reason} onChange={e=>setReason(e.target.value)}/></label>
            </fieldset>
            <footer><DeskButton onClick={closeGrant}>取消</DeskButton>
              <DeskButton type="primary" disabled={disabled || !person || !chosen || !starts || !expires || !reason.trim() || !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(expires))}
                onClick={previewPost}>预览权限</DeskButton></footer>
          </> : view?.preview ? <section aria-label="权限预览">
            <p>{view.preview.person}<span className="mute">{view.preview.scope}</span></p>
            <p>{view.preview.actions.map(a=>labels[a]).join('、')}</p><p>{formatSeatClock(view.preview.startsAt)} 至 {formatSeatClock(view.preview.expiresAt)}</p><p>{view.preview.reason}</p>
            <footer><DeskButton disabled={disabled} onClick={()=>void apply({action:'discard'})}>返回修改</DeskButton>
              <DeskButton type="primary" disabled={disabled} onClick={()=>void apply({action:'save'}).then((ok)=>{if(ok)setGrantOpen(false);})}>确认保存权限</DeskButton></footer>
          </section> : null}
      </Modal>
    </>}
  </section></div></IntakeAntdTheme>;
}
