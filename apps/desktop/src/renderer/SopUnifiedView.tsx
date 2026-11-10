import { IntakeAntdTheme } from './features/dashboard/intake-antd';
import { Button, Checkbox, Input, Select } from 'antd';
import { useEffect, useState, type RefObject } from 'react';
import { SOP_QUERY_GROUPS, type SopUnifiedCommand, type SopUnifiedProjection } from '@shared/sop-unified';
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
  const busy = waiting || projection.busy;
  useEffect(() => {
    if (!projection.shops.some(shop => shop.key === shopKey)) setShop(projection.shops.length === 1 ? projection.shops[0]!.key : '');
  }, [projection.shops, shopKey]);
  const command = async (intent: SopUnifiedCommand) => {
    setWaiting(true); setError('');
    try {
      const result = await window.sopWindow?.unifiedCommand?.(intent);
      if (!result?.ok) setError(result && !result.ok ? result.message : '操作未完成，请重试。');
    } catch { setError('操作未完成，请重试。'); }
    finally { setWaiting(false); }
  };
  const node = projection.state === 'ready' ? projection.node : null;
  return <IntakeAntdTheme><div className="sop-shell query-shell sop-unified" data-testid="sop-unified-shell" data-state={projection.state} data-busy={busy} ref={shellRef}>
    <div className="glass-shell"><div className="glass-surface" aria-hidden="true" />
      <header className="sop-chrome" {...drag}>
        <strong>{projection.title || 'SOP 流程'}</strong>
        <Button type="text" className="sop-close" aria-label="收起流程，保留进度" onClick={() => { void window.sopWindow?.close(); }}>×</Button>
      </header>
      <div className="sop-body">
        {!node && projection.state !== 'paused' && projection.state !== 'closing' ? <form className="sop-unified-query" onSubmit={event => {
          event.preventDefault(); void command({ kind: 'query', shopKey, group, text });
        }}>
          <label>店铺<Select aria-label="店铺" value={shopKey || undefined} placeholder="请选择" disabled={busy} onChange={setShop} options={projection.shops.map(shop => ({ value: shop.key, label: shop.label }))} /></label>
          <label>流程<Select aria-label="流程" value={group} disabled={busy} onChange={setGroup} options={SOP_QUERY_GROUPS.map(value => ({ value, label: value }))} /></label>
          <label>问题<Input aria-label="问题" value={text} maxLength={2048} disabled={busy} onChange={event => setText(event.target.value)} /></label>
          <Button htmlType="submit" type="primary" loading={busy} disabled={!shopKey || !text.trim()}>查询流程</Button>
        </form> : null}
        {projection.notice ? <p role="status">{projection.notice}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {projection.state === 'paused' ? <Button loading={busy} onClick={() => { void command({ kind: 'refresh' }); }}>重新确认并继续</Button> : null}
        {projection.state === 'closing' ? <Button loading={busy} onClick={() => { void command({ kind: 'clear' }); }}>按原请求确认结束</Button> : null}
        {node ? <>
          <p className="sop-stage">{node.stage}</p>
          <h2>{node.title}</h2>
          <p className="sop-prompt">{node.instruction}</p>
          {node.requirements.length ? <section aria-label="本步确认项" className="sop-unified-requirements">
            {node.requirements.map(item => <Checkbox key={item.key} checked={item.confirmed} disabled={busy || item.confirmed} onChange={() => { void command({ kind: 'confirm', key: item.key }); }}>{item.ordinal}. {item.label}</Checkbox>)}
            {!node.canAdvance ? <p>完成本步确认项并核对必需图片后才能继续。</p> : null}
          </section> : null}
          {node.knowledge.map((item, index) => <section className="sop-internal-banner" aria-label="相关知识" key={index}>
            <strong>{item.title}</strong><p>{item.body}</p>
            {item.resource ? <p>{item.owner === 'task' ? '任务' : '知识'}资料 {item.resource}</p> : null}
          </section>)}
          {node.media.map(item => <figure className="sop-unified-media" key={item.key}>
            <figcaption>{owners[item.owner]} / {item.alt}{item.required ? ' / 必需' : ''}</figcaption>
            {item.state === 'loading' ? <p role="status">图片正在读取。</p> : item.image ? <img src={item.image} alt={item.alt} onError={event => { event.currentTarget.hidden = true; void command({ kind: 'media-failed', key: item.key }); }} /> : <><p>图片暂不可用。</p><Button disabled={busy} onClick={() => { void command({ kind: 'media', key: item.key }); }}>重试图片</Button></>}
          </figure>)}
          {node.scripts.some(script => script.risk === 'high' || script.risk === 'critical') ? <p>本步只给话术，不建单、不指令仓配。</p> : null}
          {node.scripts.map(script => <article className="script-card" key={script.key}>
            <strong>{script.title}</strong><span className="risk-chip">{risks[script.risk]}</span>
            <p>{relations[script.relation]} / {script.condition}</p>
            <p className="answer-text">{script.body}</p>
            <Button disabled={busy || !script.canCopy} onClick={() => { void command({ kind: 'copy', key: script.key }); }}>复制话术</Button>
            {!script.canCopy ? <p>当前不能复制这条话术。</p> : null}
          </article>)}
          {node.kind === 'action' ? <Button type="primary" disabled={busy || !node.canAdvance} onClick={() => { void command({ kind: 'next', key: node.nextKey }); }}>下一步</Button> : null}
          {node.kind === 'decision' ? <section className="sop-branches" aria-label="判断分支">
            {node.choices.map(choice => <div key={choice.key}>
              <p>判断依据 {choice.criterion}</p>
              <Button disabled={busy || !node.canAdvance} onClick={() => { void command({ kind: 'choose', key: choice.key }); }}>{choice.label}{choice.unableToDetermine ? ' / 无法判断' : ''}</Button>
            </div>)}
          </section> : null}
          {node.kind === 'terminal' ? <p>流程已到最后一步，请人工确认处理结果。</p> : null}
          {projection.copied ? <p aria-live="polite">已复制</p> : null}
        </> : null}
        <Button className="sop-end" data-sop-end="true" disabled={busy} onClick={() => { void window.sopWindow?.endFlow(); }}>结束并清除进度</Button>
      </div>
    </div>
  </div></IntakeAntdTheme>;
}
