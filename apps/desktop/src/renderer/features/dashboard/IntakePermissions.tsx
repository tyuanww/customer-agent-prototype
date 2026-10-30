import { Button, Drawer, Empty, Input, Modal, Select, Steps, Table, type ButtonProps, type TableColumnsType, type TableProps } from 'antd';
import { createElement, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import './workbench-v9.css';
import './intake-permissions.css';
import { INTAKE_PERMISSION_ACTION_LABELS as labels, type IntakePermissionCommand, type IntakePermissionReply, type IntakePermissionView } from '@shared/content-intake-permissions';
import type { PermissionsUse } from '@shared/page-use';
import { type AsyncResource } from '@shared/async-resource';
import { actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS, intakePostsCoveredBy, isIntakePost, type IntakePost } from '@shared/intake-post-actions';
import { WORKBENCH_EMPTY } from '@shared/workbench-empty';
import type { SeatAccountIntent, SeatAccountRecord, SeatAccountReply } from '@shared/seat-account-intent';
import { formatIntakeTime, formatSeatClock, timeoutUntil } from './intake-time';
import { IntakeAntdTheme } from './intake-antd';
import { SeatDateTime } from './seat-date-time';
import { useAsyncResource } from './use-async-resource';
import { WorkbenchFailed, WorkbenchLoading, WorkbenchNoAccess, WorkbenchUncertain } from './WorkbenchState';
import type { AccessBlock } from '@shared/workbench-access';
import { memberPermissionSummary, permissionMembers, permissionStatus, shortPermissionReference, type MemberRow, type PermissionGrant } from './intake-permission-members';

function DeskButton(props: ButtonProps) {
  return <Button {...props} autoInsertSpace={false} />;
}

function PermissionsEmpty({ description }: { description: string }) {
  return <Empty image={null} description={description} />;
}

/** rc-table copies aria-label onto the table. antd's prop type omits it. */
function A11yTable<RecordType extends object>(props: TableProps<RecordType> & { 'aria-label': string }) {
  return createElement(Table as ComponentType<typeof props>, props);
}

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
      aria-label="账号管理"
      pagination={false}
      rowKey="username"
      dataSource={rows}
      locale={{ emptyText: <PermissionsEmpty description="新建坐席后会出现在这里。" /> }}
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

export function IntakePermissions({ active, canGrant = false, grantBlock = '', grantAccess = null, gate = null }: {
  active: boolean;
  canGrant?: boolean;
  grantBlock?: string;
  grantAccess?: AccessBlock | null;
  gate?: Extract<PermissionsUse, { state: 'open' }> | null;
}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [person,setPerson]=useState(''),[post,setPost]=useState<IntakePost>(DEFAULT_INTAKE_POST);
  const [starts,setStarts]=useState(''),[expires,setExpires]=useState(''),[reason,setReason]=useState('');
  const [revoke,setRevoke]=useState(''),[revokeReason,setRevokeReason]=useState('');
  const [memberKey,setMemberKey]=useState<string | null>(null);
  const [confirmRevoke,setConfirmRevoke]=useState(false);
  const revokeCancel = useRef<HTMLButtonElement>(null);
  const [,refreshClock]=useState(0);
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
  const view = gate?.body ?? (resource.status === 'ready' ? resource.value : null);
  const now = Date.now();
  const available = !!view?.signedIn && view.available && !eligibilityEnded
    && (!view.validUntil || Date.parse(view.validUntil) > now);
  const loading = view === null && resource.status === 'loading';
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
    if(active)setAllowRead(true);
  },[active]);
  useEffect(()=>{
    const api=window.dashboardPermissions;if(!api)return;
    return api.onInvalidated(()=>{if(!pending.current)void apply();});
  },[apply]);
  useEffect(()=>{
    setPerson('');setPost(DEFAULT_INTAKE_POST);setRevoke('');setRevokeReason('');
    setMemberKey(null);setConfirmRevoke(false);
  },[view?.source,available]);
  useEffect(()=>{
    setEligibilityEnded(false);
    if(!view?.validUntil)return undefined;
    const until=Date.parse(view.validUntil);
    if(!Number.isFinite(until))return undefined;
    return timeoutUntil(()=>{setEligibilityEnded(true);void apply();},until);
  },[view?.validUntil, apply]);
  useEffect(()=>{
    const next = (view?.grants ?? []).filter(grant => !grant.revoked)
      .flatMap(grant => [Date.parse(grant.startsAt), Date.parse(grant.expiresAt)])
      .filter(time => time > now);
    if (next.length === 0) return;
    return timeoutUntil(() => refreshClock(tick => tick + 1), Math.min(...next));
  },[view?.grants,now]);
  useEffect(()=>()=>{mounted.current=false;generation.current++;},[]);
  const disabled=busy || !!view?.busy || !!view?.pending;
  const readAgain=()=>{
    if(pending.current)return;
    if(resource.status==='forbidden'){reload();return;}
    void apply({action:'refresh'});
  };
  const offered=intakePostsCoveredBy(view?.actions??[]);
  const chosen=offered.includes(post)?post:undefined;
  const chosenActions = actionsForIntakePost(chosen);
  const scopeLabel = view?.sources.find(source => source.selection === view.source)?.label;
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
  const memberRows = available && view ? permissionMembers(view) : [];
  const selectedMember = memberRows.find(member => member.key === memberKey);
  const detailOpen = active && !!selectedMember && job === 'grants';
  const grantDialogOpen = active && available && grantOpen;
  const revokeTarget = selectedMember?.grants.find(grant => grant.selection === revoke);
  const revokeDisabled = disabled || !revokeTarget?.canRevoke || !!revokeTarget?.revoked || !!view?.preview;
  const closeMember = () => {
    setMemberKey(null);setRevoke('');setRevokeReason('');setConfirmRevoke(false);
  };
  const commitRevoke = () => {
    if (!available || revokeDisabled || !revokeTarget || !revokeReason.trim()) return;
    setConfirmRevoke(false);
    void apply({ action: 'revoke', selection: revokeTarget.selection, reason: revokeReason });
  };
  const operationFeedback = <>
    {error && <WorkbenchFailed message={error} onRetry={disabled || view?.preview ? undefined : readAgain} retryLabel="刷新权限列表" />}
    {view?.notice && <p role="status">{view.notice}</p>}
    {view?.pending && <WorkbenchUncertain
      message={view.resultUnknown ? '权限操作结果待确认，请按原请求确认。关闭窗口会丢失这次请求。' : '正在确认权限操作结果，请勿重复操作。'}
      checkLabel="按原请求确认结果"
      disabled={busy}
      onCheck={()=>void apply({action:'retry'})} />}
  </>;
  const memberColumns: TableColumnsType<MemberRow> = [
    { title: '成员', key: 'member', render: (_value, member) => <>{member.label}{member.kind === 'unresolved'
      ? <span className="intake-permissions-meta">记录 {shortPermissionReference(member.grants[0].reference)}</span> : null}</> },
    { title: '具备能力', key: 'abilities', render: (_value, member) => {
      const { abilities } = memberPermissionSummary(member, now);
      const names = Object.entries(labels).filter(([action]) => abilities.some(value => value === action)).map(([, label]) => label);
      return names.length ? <>{names.slice(0, 2).join('、')}{names.length > 2 && <span className="intake-permissions-meta">等 {names.length} 项</span>}</> : '—';
    } },
    { title: '当前状态', key: 'status', render: (_value, member) => <div className="intake-permissions-statuses">
      {member.grants.length === 0 ? '未授权' : memberPermissionSummary(member, now).counts.map(([status, count]) =>
        <span className="intake-permissions-status" data-status={status} key={status}>{status} {count} 项</span>)}
    </div> },
    { title: '操作', key: 'ops', width: 112, render: (_value, member) => <DeskButton type="text" onClick={() => {
      setMemberKey(member.key);setRevoke('');setRevokeReason('');setConfirmRevoke(false);
    }}>查看权限</DeskButton> },
  ];
  const grantColumns: TableColumnsType<PermissionGrant> = [
    { title: '权限与范围', key: 'permission', render: (_value, grant) => <>{labels[grant.action]}
      <span className="intake-permissions-meta">{grant.scope}</span>
      <span className="intake-permissions-meta">记录 {shortPermissionReference(grant.reference)}</span>
      {grant.reason.trim() ? <details className="intake-permissions-reason"><summary>授权原因</summary><p>{grant.reason}</p></details> : null}
    </> },
    { title: '有效期', key: 'period', width: 192, render: (_value, grant) =>
      <><time dateTime={grant.startsAt} title={formatIntakeTime(grant.startsAt)}>{formatSeatClock(grant.startsAt)}</time><br />{' 至 '}
        <time dateTime={grant.expiresAt} title={formatIntakeTime(grant.expiresAt)}>{formatSeatClock(grant.expiresAt)}</time></> },
    { title: '状态', key: 'status', width: 90, render: (_value, grant) => {
      const status = permissionStatus(grant, now);
      return <span className="intake-permissions-status" data-status={status}>{status}</span>;
    } },
    { title: '操作', key: 'ops', width: 124, render: (_value, grant) => grant.revoked ? '—' : <DeskButton type="text" danger disabled={disabled || !grant.canRevoke || !!view?.preview} onClick={() => { setRevoke(grant.selection); setRevokeReason(''); }}>撤销该权限</DeskButton> },
  ];
  return <IntakeAntdTheme><div className="desk-permissions-page wb9"><section className="intake-management desk-permissions wb9" aria-label="权限配置">
    <h1 className="desk-sr">权限配置</h1>
    {loading ? <WorkbenchLoading rows={5} label="正在读取权限" /> : null}
    {!gate && resource.status === 'forbidden' ? <p>{resource.message}</p> : null}
    {!gate && resource.status === 'error' ? <WorkbenchFailed message={resource.message} onRetry={disabled ? undefined : readAgain} retryLabel="刷新权限列表" /> : null}
    {!detailOpen && !grantDialogOpen && operationFeedback}
    {!available && <div className="toolbar" style={{marginBottom:12}}><div className="left">
      <DeskButton disabled={disabled || !!view?.preview} onClick={readAgain}>刷新权限列表</DeskButton>
      {(busy || view?.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}</div></div>}
    {view && !view.signedIn && <p>请先登录。</p>}
    {view?.signedIn && !available && !view.pending && <p>{eligibilityEnded ? '登录状态需要确认。请刷新权限列表。' : '请刷新权限列表。'}</p>}
    {available && view && <>
      <div className="tabbar"><div className="tabs intake-job-switch" role="tablist" aria-label="权限工作">
        <DeskButton type="text" className="tab" role="tab" aria-selected={job==='grants'} onClick={()=>setJob('grants')}>成员权限</DeskButton>
        <DeskButton type="text" className="tab" role="tab" aria-selected={job==='seats'} onClick={()=>{closeGrant();closeMember();setJob('seats');}}>账号管理</DeskButton>
      </div>
        <span className="row" style={{display:'inline-flex',gap:8,marginBottom:8}}>
          {(busy || view.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}
          {job==='grants'
            ? ((gate || canGrant)
              ? <DeskButton type="primary" style={{marginBottom:0}} disabled={disabled || !view.source} onClick={()=>setGrantOpen(true)}>新增授权</DeskButton>
              : null)
            : <DeskButton type="primary" style={{marginBottom:0}} onClick={()=>setSeatCreateOpen(true)}>新建坐席</DeskButton>}
        </span>
      </div>
      {!gate && job==='grants' && grantAccess ? <WorkbenchNoAccess need={grantAccess.need} ask={grantAccess.ask} detail={grantAccess.detail} />
        : !gate && grantBlock ? <p role="status">{grantBlock}</p> : null}
      <div hidden={job!=='grants'}>
        <div className="intake-permissions-scope"><label className="lbl" htmlFor="permissions-scope">配置范围</label>
          <Select<string> id="permissions-scope" aria-label="配置范围" disabled={disabled || !!view.preview} value={view.source ?? undefined} placeholder="请选择已有范围" virtual={false}
            options={view.sources.map(source => ({ value: source.selection, label: source.label }))} onChange={selection => { void apply({ action: 'source', selection }); }} />
          <DeskButton aria-label="刷新权限列表" disabled={disabled || !!view.preview} onClick={readAgain}>刷新</DeskButton></div>
        <A11yTable<MemberRow> className="intake-permissions-members" aria-label="成员权限" pagination={false} rowKey="key" tableLayout="fixed" dataSource={memberRows} columns={memberColumns}
          locale={{ emptyText: <PermissionsEmpty description={view.source ? '添加成员或授权后会出现在这里。' : '请选择配置范围。'} /> }} />
      </div>
      <Drawer open={detailOpen} title={selectedMember ? `${selectedMember.label}的权限` : '权限详情'} size={800}
        rootClassName="intake-permissions-detail" destroyOnHidden onClose={closeMember}>
        {detailOpen && operationFeedback}
        {(busy || view.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}
        <A11yTable<PermissionGrant> aria-label="权限明细" pagination={false} rowKey="selection" tableLayout="fixed" scroll={{ x: 680 }} dataSource={selectedMember?.grants ?? []} columns={grantColumns}
          locale={{ emptyText: <PermissionsEmpty description="开通权限后会出现在这里。" /> }} />
        {revokeTarget && !revokeTarget.revoked ? <fieldset className="intake-permissions-form" disabled={revokeDisabled}>
          <div>{labels[revokeTarget.action]}<span className="intake-permissions-meta">{revokeTarget.scope}，记录 {shortPermissionReference(revokeTarget.reference)}</span></div>
          <label><span>撤销原因</span><Input aria-label="撤销原因" disabled={revokeDisabled} maxLength={512} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></label>
          <div className="intake-permissions-actions">
            <DeskButton disabled={disabled} onClick={() => setRevoke('')}>取消</DeskButton>
            <DeskButton danger disabled={revokeDisabled || !revokeReason.trim()} onClick={() => setConfirmRevoke(true)}>确认撤销</DeskButton>
          </div>
        </fieldset> : null}
      </Drawer>
      <Modal open={active && confirmRevoke && !!revokeTarget && !revokeTarget.revoked} title={revokeTarget ? `收回 ${revokeTarget.person} 在 ${revokeTarget.scope}的${labels[revokeTarget.action]}` : '撤销权限'}
        footer={null} destroyOnHidden transitionName="" maskTransitionName="" onCancel={() => setConfirmRevoke(false)}
        afterOpenChange={open => { if (open) revokeCancel.current?.focus(); }}>
        <p>仅撤销这条权限。撤销后如需使用，须重新授权。</p>
        {revokeTarget ? <p>{formatSeatClock(revokeTarget.startsAt)} 至 {formatSeatClock(revokeTarget.expiresAt)}<span className="intake-permissions-meta">记录 {shortPermissionReference(revokeTarget.reference)}</span></p> : null}
        <div className="intake-permissions-actions">
          <Button ref={revokeCancel} autoInsertSpace={false} onClick={() => setConfirmRevoke(false)}>取消</Button>
          <DeskButton danger disabled={revokeDisabled || !revokeReason.trim()} onClick={commitRevoke}>确认收回</DeskButton>
        </div>
      </Modal>
      <div hidden={job!=='seats'}><SeatAccounts disabled={disabled} createOpen={seatCreateOpen} setCreateOpen={setSeatCreateOpen} /></div>
      <Modal open={grantDialogOpen} title={view.preview ? '预览，尚未保存' : '新增授权'} width={520} footer={null} destroyOnHidden transitionName="" maskTransitionName="" onCancel={closeGrant}>
          {grantDialogOpen && operationFeedback}
          {(busy || view.busy) && <DeskButton onClick={()=>void apply({action:'stop'})}>停止等待</DeskButton>}
          <Steps size="small" current={view.preview ? 1 : 0} items={[{ title: '设置权限' }, { title: '确认保存' }]} />
          {!view.preview ? <>
            <fieldset className="intake-permissions-form" disabled={disabled}>
              <div><span className="intake-permissions-meta">授权范围</span>{scopeLabel}</div>
              <div className="two"><label><span>成员</span><Select<string> aria-label="成员" value={person || undefined} placeholder="请选择成员" disabled={disabled} virtual={false}
                options={view.people.map(item => ({ value: item.selection, label: item.label }))} onChange={setPerson} /></label>
              <label><span>岗位</span><Select<string> aria-label="岗位" value={chosen} disabled={disabled || offered.length === 0} virtual={false}
                placeholder={offered.length === 0 ? '当前范围没有可授予的岗位' : '请选择岗位'} options={offered.map(name => ({ value: name, label: name }))} onChange={choosePost} /></label></div>
              {chosenActions.ok ? <div><span className="intake-permissions-meta">包含能力</span>{chosenActions.actions.map(action => labels[action]).join('、')}</div> : null}
              <div className="two"><label><span>生效时间</span><SeatDateTime label="生效时间" placeholder="选择生效时间" value={starts} onChange={setStarts} disabled={disabled} /></label>
              <label><span>失效时间</span><SeatDateTime label="失效时间" placeholder="选择失效时间" value={expires} onChange={setExpires} disabled={disabled} /></label></div>
              <span className="intake-permissions-meta">时间为本机时间</span>
              <label><span>授权原因</span><Input aria-label="授权原因" disabled={disabled} maxLength={512} value={reason} onChange={e=>setReason(e.target.value)}/></label>
            </fieldset>
            <footer className="intake-permissions-actions"><DeskButton onClick={closeGrant}>取消</DeskButton>
              <DeskButton type="primary" disabled={disabled || !person || !chosen || !starts || !expires || !reason.trim() || !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(expires))}
                onClick={previewPost}>预览权限</DeskButton></footer>
          </> : <section aria-label="权限预览">
            <dl className="intake-permissions-preview">
              <div><dt>成员</dt><dd>{view.preview.person}</dd></div>
              <div><dt>授权范围</dt><dd>{view.preview.scope}</dd></div>
              <div><dt>包含能力</dt><dd>{view.preview.actions.map(a=>labels[a]).join('、')}</dd></div>
              <div><dt>有效期</dt><dd>{formatSeatClock(view.preview.startsAt)} 至 {formatSeatClock(view.preview.expiresAt)}</dd></div>
              <div><dt>授权原因</dt><dd>{view.preview.reason}</dd></div>
            </dl>
            <footer className="intake-permissions-actions"><DeskButton disabled={disabled} onClick={()=>void apply({action:'discard'})}>返回修改</DeskButton>
              <DeskButton type="primary" disabled={disabled} onClick={()=>void apply({action:'save'}).then((ok)=>{if(ok)setGrantOpen(false);})}>确认保存权限</DeskButton></footer>
          </section>}
      </Modal>
    </>}
  </section></div></IntakeAntdTheme>;
}
