import { IntakeAntdTheme } from './features/dashboard/intake-antd';
import { Button, Checkbox, Input, Modal, Select } from 'antd';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { SOP_INSTANCE_NAME_MAX_LENGTH, SOP_QUERY_GROUPS, sopCaseLabel, type SopUnifiedCommand, type SopUnifiedNode, type SopUnifiedProjection } from '@shared/sop-unified';
import type { SopQueryGroup } from '@shared/sop-query';
import type { useWindowDrag } from './lib/use-window-drag';

const relations = { independent: '独立话术', alternative: '择一话术', complementary: '补充话术' };
const risks = { low: '低风险', medium: '需人工核对', high: '高风险，需复核', critical: '高风险，需复核' };
const owners = { entry: '话术资料', task: '任务资料', knowledge: '知识资料' };

export function SopUnifiedView({ projection, shellRef, drag }: {
  projection: SopUnifiedProjection;
  shellRef: RefObject<HTMLDivElement>;
  drag: ReturnType<typeof useWindowDrag>;
}) {
  const [shopKey, setShop] = useState('');
  const [group, setGroup] = useState<SopQueryGroup>(SOP_QUERY_GROUPS[0]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const guidanceId = useId();
  const endCancel = useRef<HTMLButtonElement>(null);
  const busy = waiting || projection.busy;
  useEffect(() => {
    if (!projection.shops.some(shop => shop.key === shopKey)) setShop(projection.shops.length === 1 ? projection.shops[0]!.key : '');
  }, [projection.shops, shopKey]);
  const command = async (intent: SopUnifiedCommand) => {
    setWaiting(true); setError('');
    try {
      const result = await window.sopWindow?.unifiedCommand?.(intent);
      if (result?.ok) return true;
      setError(result && !result.ok ? result.message : '操作未完成，请重试。');
    } catch { setError('操作未完成，请重试。'); }
    finally { setWaiting(false); }
    return false;
  };
  const node = projection.state === 'ready' ? projection.node : null;
  const caseName = projection.instanceName || projection.title || 'SOP 流程';
  const caseTitle = projection.caseNumber ? sopCaseLabel(projection.caseNumber, caseName) : caseName;
  const canEndCase = Boolean(projection.caseNumber && projection.state !== 'closing');
  const endDialogOpen = canEndCase && confirmEnd;
  useEffect(() => {
    if (!canEndCase) setConfirmEnd(false);
  }, [canEndCase]);
  const canPark = Boolean(projection.caseNumber && projection.instanceName && !busy && !endDialogOpen && nameDraft === null);
  const requiredMedia = node?.media.filter(item => item.required) ?? [];
  const missingMedia = requiredMedia.filter(item => item.state !== 'ready');
  const pendingConfirmations = node?.requirements.filter(item => !item.confirmed).map(item => item.label).join('、');
  const advanceGuidance = node && node.kind !== 'terminal' && !node.canAdvance ? guidanceId : undefined;
  const renderMedia = (item: SopUnifiedNode['media'][number]) => (
    <figure className="sop-unified-media" key={item.key}>
      <figcaption>{owners[item.owner]} / {item.alt}</figcaption>
      {item.state === 'loading' ? <p role="status">图片正在读取。</p> : item.state === 'ready' ?
        <img src={item.image} alt={item.alt} onError={event => {
          event.currentTarget.hidden = true;
          void command({ kind: 'media-failed', key: item.key });
        }} /> : <>
          <p>图片暂不可用。</p>
          <Button disabled={busy} onClick={() => { void command({ kind: 'media', key: item.key }); }}>重试图片</Button>
        </>}
    </figure>
  );
  return <IntakeAntdTheme><div className="sop-shell query-shell sop-unified" data-testid="sop-unified-shell" data-state={projection.state} data-busy={busy}
    data-confirm-ending={endDialogOpen} ref={shellRef}
    onPointerLeave={event => {
      const goingToResize = event.relatedTarget instanceof Element && event.relatedTarget.closest('.sop-resize-handles');
      if (canPark && event.buttons === 0 && !goingToResize
        && !event.currentTarget.querySelector('input:focus, textarea:focus, [contenteditable]:focus')) {
        void window.sopWindow?.bookmark?.('park-after-edge-drag');
      }
    }}>
    <div className="glass-shell"><div className="glass-surface" aria-hidden="true" />
      <header className="sop-chrome">
        <div className="sop-chrome-drag" aria-hidden="true" {...drag} />
        <div className="sop-chrome-title" title={caseTitle}><strong>{caseTitle}</strong></div>
        {node && projection.instanceName && nameDraft === null ? <Button type="text" className="sop-park"
          disabled={busy} onClick={() => setNameDraft(projection.instanceName ?? '')}>重命名</Button> : null}
        {projection.caseNumber && projection.instanceName && window.sopWindow?.bookmark ? <Button type="text" className="sop-park" autoInsertSpace={false} disabled={!canPark} onClick={() => {
          void window.sopWindow?.bookmark?.('park').then(result => {
            if (!result.ok) setError(result.message);
          });
        }}>暂放</Button> : null}
        {canEndCase ? <Button type="text" className="sop-park" disabled={busy}
          onClick={() => setConfirmEnd(true)}>结束办理</Button> : null}
        <Button type="text" className="sop-close" aria-label="收起流程，保留进度" onClick={() => { void window.sopWindow?.close(); }}>×</Button>
      </header>
      <div className="sop-body"><div className="sop-unified-content">
        {!node && projection.entry !== 'candidate' && projection.state !== 'paused' && projection.state !== 'closing' ? <form className="sop-unified-query" onSubmit={event => {
          event.preventDefault(); void command({ kind: 'query', shopKey, group, text });
        }}>
          <label>店铺<Select aria-label="店铺" value={shopKey || undefined} placeholder="请选择" disabled={busy} onChange={setShop} options={projection.shops.map(shop => ({ value: shop.key, label: shop.label }))} /></label>
          <label>流程<Select aria-label="流程" value={group} disabled={busy} onChange={setGroup} options={SOP_QUERY_GROUPS.map(value => ({ value, label: value }))} /></label>
          <label>问题<Input aria-label="问题" value={text} maxLength={2048} disabled={busy} onChange={event => setText(event.target.value)} /></label>
          <Button htmlType="submit" type="primary" loading={busy} disabled={!shopKey || !text.trim()}>查询流程</Button>
        </form> : null}
        {!node && projection.notice ? <p role="status">{projection.notice}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {projection.state === 'paused' ? <Button loading={busy} onClick={() => { void command({ kind: 'refresh' }); }}>重新确认并继续</Button> : null}
        {projection.state === 'closing' ? <Button loading={busy} onClick={() => { void command({ kind: 'clear' }); }}>按原请求确认结束</Button> : null}
        {node ? <>
          {projection.instanceName && nameDraft !== null ? <form className="sop-unified-query" onSubmit={event => {
              event.preventDefault();
              if (nameDraft.trim() && !busy) void command({ kind: 'rename', name: nameDraft }).then(saved => {
                if (saved) setNameDraft(null);
              });
            }}>
              <label>办理名称<Input autoFocus aria-label="办理名称" value={nameDraft} maxLength={SOP_INSTANCE_NAME_MAX_LENGTH} disabled={busy} onChange={event => setNameDraft(event.target.value)} /></label>
              <Button htmlType="submit" disabled={busy || !nameDraft.trim()}>保存名称</Button>
              <Button disabled={busy} onClick={() => setNameDraft(null)}>取消</Button>
            </form> : null}
          <p className="sop-stage">{node.stage}</p>
          <h2>{node.title}</h2>
          <p className="sop-prompt">{node.instruction}</p>
          {node.requirements.length ? <section aria-label="本步确认项" className="sop-unified-requirements">
            <h3>本步确认项</h3>
            {node.requirements.map(item => <Checkbox key={item.key} checked={item.confirmed} disabled={busy || item.confirmed} onChange={() => { void command({ kind: 'confirm', key: item.key }); }}>{item.ordinal}. {item.label}</Checkbox>)}
          </section> : null}
          {advanceGuidance ? <div className="sop-unified-guidance" role="status" id={advanceGuidance}>
            {pendingConfirmations ? <p>待确认：{pendingConfirmations}</p> : null}
            {missingMedia.map(item => <p key={item.key}>必需图片「{item.alt}」{item.state === 'loading' ? '正在读取。' : '暂不可用。'}</p>)}
            {!pendingConfirmations && !missingMedia.length ? <p>{projection.notice || '当前无法继续。'}</p> : null}
          </div> : null}
          {requiredMedia.length ? <section aria-label="必需图片" className="sop-unified-required-media">
            <h3>必需图片</h3>
            {requiredMedia.map(renderMedia)}
          </section> : null}
          {node.knowledge.length ? <details className="sop-unified-knowledge">
            <summary>补充资料与知识</summary>
            {node.knowledge.map((item, index) => <section className="sop-internal-banner" aria-label="相关知识" key={index}>
              <strong>{item.title}</strong><p>{item.body}</p>
              {item.resource ? <p>{item.owner === 'task' ? '任务' : '知识'}资料 {item.resource}</p> : null}
            </section>)}
          </details> : null}
          {node.media.filter(item => !item.required).map(renderMedia)}
          {node.scripts.some(script => script.risk === 'high' || script.risk === 'critical') ? <p>本步只给话术，不建单、不指令仓配。</p> : null}
          {node.scripts.map(script => <article className="script-card" key={script.key}>
            <strong>{script.title}</strong><span className="risk-chip">{risks[script.risk]}</span>
            <p>{relations[script.relation]} / {script.condition}</p>
            <p className="answer-text">{script.body}</p>
            <Button disabled={busy || !script.canCopy} onClick={() => { void command({ kind: 'copy', key: script.key }); }}>复制话术</Button>
            {!script.canCopy ? <p>当前不能复制这条话术。</p> : null}
          </article>)}
          {node.kind === 'decision' ? <section className="sop-branches" aria-label="判断分支">
            {node.choices.map(choice => <div key={choice.key}>
              <p>判断依据 {choice.criterion}</p>
              <Button aria-describedby={advanceGuidance} disabled={busy || !node.canAdvance} onClick={() => { void command({ kind: 'choose', key: choice.key }); }}>{choice.label}{choice.unableToDetermine ? ' / 无法判断' : ''}</Button>
            </div>)}
          </section> : null}
          {node.kind === 'terminal' ? <p>流程已到最后一步，请人工确认处理结果。</p> : null}
          {projection.copied ? <p aria-live="polite">已复制</p> : null}
        </> : null}
      </div></div>
      <footer className="sop-unified-actions">
        {projection.caseNumber === undefined ? <Button type="text" className="sop-end" data-sop-end="true" disabled={busy}
          onClick={() => { void window.sopWindow?.endFlow(); }}>结束并清除进度</Button> : null}
        {node?.kind === 'action' ? <Button type="primary" aria-describedby={advanceGuidance}
          disabled={busy || !node.canAdvance} onClick={() => { void command({ kind: 'next', key: node.nextKey }); }}>下一步</Button> : null}
      </footer>
    </div>
    <Modal open={endDialogOpen} title="结束当前办理？" width={360} centered
      closable={false} mask={{ closable: false }} destroyOnHidden transitionName="" maskTransitionName=""
      afterOpenChange={open => { if (open) endCancel.current?.focus(); }}
      onCancel={() => setConfirmEnd(false)}
      footer={[
        <Button key="cancel" ref={endCancel} autoInsertSpace={false} onClick={() => setConfirmEnd(false)}>取消</Button>,
        <Button key="confirm" type="primary" danger disabled={busy} onClick={() => {
          setConfirmEnd(false);
          void command({ kind: 'clear' });
        }}>确认结束</Button>,
      ]}>
      <p className="sop-end-details">「{caseTitle}」的进度将被清除。其他办理可以继续。</p>
    </Modal>
  </div></IntakeAntdTheme>;
}
