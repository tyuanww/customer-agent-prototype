import { useState, useEffect } from 'react';
import {
  DESK_CATEGORIES,
  TACIT_KINDS,
  type DeskCommand,
  type DeskItemView,
  type DeskView,
} from '@shared/desk-knowledge';
import './intake-management.css';

const EMPTY: DeskView = {
  signedIn: false, role: null, displayName: null, personas: [], selectedPersonaId: 'shop',
  items: [], delivered: [], tacit: [], revision: 0, notice: null, persistence: 'ok',
};

function statusTone(item: DeskItemView): string {
  if (item.parseState !== 'ok') return 'is-failed';
  if (item.statusLabel === '生效中') return 'is-live';
  return 'is-idle';
}

/** Operator view edits one persona. A seat only sees knowledge that is already
 * effective for that persona, including the shared shop set. */
export function DeskKnowledge() {
  const api = window.dashboardDesk;
  const [view, setView] = useState<DeskView>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [tacitOpen, setTacitOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('product');
  const [customCategory, setCustomCategory] = useState('');
  const [text, setText] = useState('');
  const [validity, setValidity] = useState('always');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [tacitKind, setTacitKind] = useState('insight');
  const [tacitText, setTacitText] = useState('');

  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    void api.current().then((reply) => {
      if (!live) return;
      if (reply.view) setView(reply.view);
      if (!reply.ok) setMessage(reply.message);
    }).catch(() => { if (live) setMessage('知识库暂时读不出来。'); });
    return () => { live = false; };
  }, [api]);

  async function apply(command: DeskCommand) {
    if (!api) return;
    setBusy(true);
    try {
      const reply = await api.command(command);
      if (reply.view) setView(reply.view);
      setMessage(reply.ok ? (command.action === 'import-csv' ? reply.view.notice : null) : reply.message);
      if (reply.ok && command.action === 'upload') { setName(''); setText(''); }
      if (reply.ok && command.action === 'import-csv') setWriting(false);
      if (reply.ok && command.action === 'add-tacit') setTacitText('');
    } catch {
      setMessage('知识库暂时读不出来。');
    } finally {
      setBusy(false);
    }
  }

  if (!api) {
    return <section className="desk-knowledge" aria-label="知识库"><div className="desk-column"><header className="desk-title"><h1>知识库</h1></header><p>当前运行模式没有接上知识库。</p></div></section>;
  }
  const operator = view.role === 'operator';
  const cards = view.role === null ? null : view.items;
  const rows = !cards || cards.length === 0
    ? <tr><td colSpan={5} className="desk-empty">{operator ? '还没有知识。' : '还没有生效知识。'}</td></tr>
    : cards.map((item) => <tr key={item.id}>
      <td>{item.name}</td>
      <td><span className="desk-body" title={item.body}>{item.body}</span></td>
      <td><span className={`desk-status ${statusTone(item)}`}>{item.statusLabel}</span></td>
      <td>{item.updatedAt.slice(0, 16).replace('T', ' ')}</td>
      <td>{operator ? <div className="desk-row-actions">
        {item.validity !== 'always'
          ? <button type="button" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'always' })}>改为长期生效</button>
          : <button type="button" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'inactive' })}>改为不生效</button>}
        {item.parseState !== 'ok' ? <button type="button" disabled={busy} onClick={() => void apply({ action: 'retry', id: item.id })}>重试</button> : null}
        <button type="button" className="desk-delete" disabled={busy} onClick={() => setPendingDelete(item.id)}>删除</button>
      </div> : null}</td>
    </tr>);
  return <section className="desk-knowledge" aria-label="知识库">
    <div className="desk-column">
      <header className="desk-title">
        <h1>知识库</h1>
        <div className="desk-title-actions">
          {view.signedIn ? <button type="button" className="desk-text-button" onClick={() => setTacitOpen(true)}>隐性知识</button> : null}
          {operator ? <button type="button" className="desk-add" onClick={() => setWriting(true)}>添加话术</button> : null}
        </div>
      </header>
      <div className="desk-toolbar">
        <div className="desk-personas" role="group" aria-label="人设">
          {view.personas.map((persona) => <button key={persona.id} type="button" aria-pressed={persona.id === view.selectedPersonaId} disabled={busy}
            onClick={() => void apply({ action: 'select-persona', personaId: persona.id })}>{persona.name}</button>)}
        </div>
      </div>
      {view.role !== null ? <p className="desk-note">坐席会收到 {view.delivered.length} 条。全店生效的知识会一起送到这个人设。</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {view.notice && view.notice !== message ? <p role="status">{view.notice}</p> : null}
      <table className="desk-table" aria-label="当前人设知识">
        <thead><tr><th>话术名称</th><th>话术内容</th><th>状态</th><th>最后更新时间</th><th>操作</th></tr></thead>
        <tbody>
          {view.role === null
            ? <tr><td colSpan={5} className="desk-empty">{view.signedIn ? '正在读取知识库。' : '请先登录。'}</td></tr>
            : rows}
        </tbody>
      </table>
    </div>
    {operator && writing ? <div className="desk-layer-backdrop">
      <div className="desk-layer" role="dialog" aria-labelledby="desk-write-title">
        <div className="desk-layer-body">
          <h2 id="desk-write-title">添加话术</h2>
          <label className="desk-field"><span className="desk-field-label">问题<span className="desk-required" aria-hidden="true">*</span></span>
            <input aria-label="问题" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="desk-field"><span className="desk-field-label">分类</span>
            <select aria-label="分类" value={category} onChange={(event) => setCategory(event.target.value)}>{DESK_CATEGORIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          {category === 'custom' ? <label className="desk-field"><span className="desk-field-label">自定分类</span>
            <input aria-label="自定分类" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} /></label> : null}
          <label className="desk-field"><span className="desk-field-label">答案<span className="desk-required" aria-hidden="true">*</span></span>
            <textarea aria-label="答案" value={text} onChange={(event) => setText(event.target.value)} /></label>
          <div className="desk-field">
            <span className="desk-field-label">有效期</span>
            <div className="desk-validity" role="group" aria-label="有效期">
              {([['always', '长期生效'], ['inactive', '不生效'], ['scheduled', '定时生效']] as const).map(([value, label]) =>
                <button key={value} type="button" aria-pressed={validity === value} onClick={() => setValidity(value)}>{label}</button>)}
            </div>
          </div>
          {validity === 'scheduled' ? <>
            <label className="desk-field"><span className="desk-field-label">开始</span>
              <input aria-label="开始" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} placeholder="2026-10-13T00:00:00.000Z" /></label>
            <label className="desk-field"><span className="desk-field-label">结束</span>
              <input aria-label="结束" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} placeholder="2026-10-20T00:00:00.000Z" /></label>
          </> : null}
          <div className="desk-layer-actions">
            <button className="desk-save" type="button" disabled={busy} onClick={() => void apply({
              action: 'upload', personaId: view.selectedPersonaId, name, category, customCategory, fileName: '问答.txt', text, validity,
              validFrom: validFrom || undefined, validUntil: validUntil || undefined,
            })}>保存</button>
            <button className="desk-cancel" type="button" onClick={() => setWriting(false)}>取消</button>
          </div>
          <div className="desk-import">
            <label>导入 CSV <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                void apply({
                  action: 'import-csv', personaId: view.selectedPersonaId, fileName: file.name,
                  csvText: typeof reader.result === 'string' ? reader.result : '', category, customCategory,
                });
              };
              reader.readAsText(file);
            }} /></label>
            <p>表头沿用原来的「问题 / 标准话术」，分类可写售前、售后、产品、活动。导入后是未生效。这一层的「长期生效」不作用于导入批次。</p>
          </div>
        </div>
      </div>
    </div> : null}
    {pendingDelete ? <div className="desk-layer-backdrop">
      <div className="desk-layer desk-layer-delete" role="dialog" aria-labelledby="desk-delete-title">
        <div className="desk-layer-body">
          <h2 id="desk-delete-title">确认删除</h2>
          <p className="desk-delete-copy">确定要删除吗？删除后将无法恢复。</p>
          <div className="desk-layer-actions">
            <button className="desk-delete-cancel" type="button" onClick={() => setPendingDelete(null)}>取消</button>
            <button className="desk-delete-confirm" type="button" disabled={busy} onClick={() => {
              const id = pendingDelete;
              setPendingDelete(null);
              void apply({ action: 'remove', id });
            }}>确认删除</button>
          </div>
        </div>
      </div>
    </div> : null}
    {tacitOpen ? <div className="desk-layer-backdrop">
      <div className="desk-layer" role="dialog" aria-labelledby="desk-tacit-title">
        <div className="desk-layer-body">
          <h2 id="desk-tacit-title">隐性知识</h2>
          <p className="desk-tacit-note">对话里记下的经验先放在这里。经验洞察约 30 天后淡化，情境上下文约 14 天后淡化。交给知识库之后仍是「未生效」，要改成长期生效才会到坐席。</p>
          {view.signedIn ? <>
            <label className="desk-tacit-field">类型 <select value={tacitKind} onChange={(event) => setTacitKind(event.target.value)}>{TACIT_KINDS.map((kind) => <option key={kind.code} value={kind.code}>{kind.label}</option>)}</select></label>
            <label className="desk-tacit-field">内容 <textarea value={tacitText} onChange={(event) => setTacitText(event.target.value)} /></label>
            <div className="desk-layer-actions"><button type="button" disabled={busy} onClick={() => void apply({ action: 'add-tacit', personaId: view.selectedPersonaId, kind: tacitKind, text: tacitText })}>记下</button>
              <button type="button" className="desk-cancel" onClick={() => setTacitOpen(false)}>关闭</button></div>
            <ul aria-label="隐性知识">{view.tacit.map((note) => <li key={note.id}>{TACIT_KINDS.find((kind) => kind.code === note.kind)?.label} · {note.text} {note.promotedItemId ? '已交给知识库' : operator ? <button type="button" disabled={busy} onClick={() => void apply({ action: 'promote', noteId: note.id })}>交给知识库</button> : null}</li>)}</ul>
          </> : <p>登录后才能记下隐性知识。</p>}
        </div>
      </div>
    </div> : null}
  </section>;
}
