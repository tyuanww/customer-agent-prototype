import { useEffect, useRef, useState } from 'react';
import {
  DESK_CATEGORIES,
  type DeskCommand,
  type DeskItemView,
  type DeskView,
} from '@shared/desk-knowledge';
import './intake-management.css';
import './workbench-v9.css';

type CsvPreview = { fileName: string; size: number; csvText: string; count: number; sample: ReadonlyArray<readonly [string, string]> };

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function previewCsv(fileName: string, size: number, csvText: string): CsvPreview {
  const rows = splitCsv(csvText);
  const header = rows[0] ?? [];
  const questionAt = Math.max(0, header.findIndex((value) => value.trim() === '问题'));
  const categoryAt = header.findIndex((value) => value.trim() === '分类');
  const usable = rows.slice(1).filter((row) => (row[questionAt]?.trim() ?? '') !== '');
  return {
    fileName, size, csvText, count: usable.length,
    sample: usable.slice(0, 3).map((row) => [row[questionAt]?.trim() ?? '', categoryAt >= 0 ? row[categoryAt]?.trim() ?? '' : ''] as const),
  };
}

const formatSize = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

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
export function DeskKnowledge({
  draftQuestion = null,
  onDraftConsumed,
}: {
  draftQuestion?: string | null;
  onDraftConsumed?: () => void;
} = {}) {
  const api = window.dashboardDesk;
  const [view, setView] = useState<DeskView>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'manual'>('upload');
  const [csv, setCsv] = useState<CsvPreview | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('product');
  const [customCategory, setCustomCategory] = useState('');
  const [text, setText] = useState('');
  const [validity, setValidity] = useState('always');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const consumedDraft = useRef<string | null>(null);

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

  useEffect(() => {
    if (!draftQuestion || draftQuestion === consumedDraft.current) return;
    if (view.role !== 'operator') return;
    consumedDraft.current = draftQuestion;
    setName(draftQuestion);
    setAddMode('manual');
    setWriting(true);
    onDraftConsumed?.();
  }, [draftQuestion, onDraftConsumed, view.role]);

  async function apply(command: DeskCommand) {
    if (!api) return;
    setBusy(true);
    try {
      const reply = await api.command(command);
      if (reply.view) setView(reply.view);
      setMessage(reply.ok ? (command.action === 'import-csv' ? reply.view.notice : null) : reply.message);
      if (reply.ok && command.action === 'upload') { setName(''); setText(''); }
      if (reply.ok && command.action === 'import-csv') { setWriting(false); setCsv(null); setConfirmImport(false); }
      if (!reply.ok) setConfirmImport(false);
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
      <td><span className="state"><i className={`dot${item.statusLabel === '生效中' ? ' ok' : item.statusLabel === '待生效' ? ' wait' : ''}`} />{item.statusLabel}</span></td>
      <td>{item.updatedAt.slice(0, 16).replace('T', ' ')}</td>
      <td>{operator ? <div className="acts">
        {item.validity !== 'always'
          ? <button type="button" className="link" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'always' })}>改为长期生效</button>
          : <button type="button" className="link" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'inactive' })}>改为不生效</button>}
        {item.parseState !== 'ok' ? <button type="button" className="link" disabled={busy} onClick={() => void apply({ action: 'retry', id: item.id })}>重试</button> : null}
        <button type="button" className="link danger" disabled={busy} onClick={() => setPendingDelete(item.id)}>删除</button>
      </div> : null}</td>
    </tr>);
  return <section className="desk-knowledge wb9" aria-label="知识库">
    <div className="desk-column">
      <h1 className="desk-sr">知识库</h1>
      <div className="tabbar">
        <div className="tabs" role="group" aria-label="人设">
          {view.personas.map((persona) => <button key={persona.id} type="button" className="tab" aria-pressed={persona.id === view.selectedPersonaId} disabled={busy}
            onClick={() => void apply({ action: 'select-persona', personaId: persona.id })}>{persona.name}</button>)}
        </div>
        {operator ? <button type="button" className="btn btn-primary desk-add" onClick={() => { setAddMode('upload'); setCsv(null); setConfirmImport(false); setWriting(true); }}>添加话术</button> : null}
      </div>
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
    {operator && writing ? <div className="mask on" onClick={(event) => { if (event.target === event.currentTarget) setWriting(false); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="desk-write-title">
        <header><h3 id="desk-write-title">添加话术</h3>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setWriting(false)}><svg className="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header>
        {addMode === 'upload' ? <>
          {!csv ? <label className="drop" tabIndex={0} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            const csvFile = !!file && (file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || /\.csv$/i.test(file.name));
            if (!csvFile || !file || busy) return;
            const reader = new FileReader();
            reader.onload = () => setCsv(previewCsv(file.name, file.size, typeof reader.result === 'string' ? reader.result : ''));
            reader.readAsText(file);
          }}>
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /><path d="M5 15v4h14v-4" /></svg>
            <b>拖拽文档到这里，或点击选择</b><span className="hint">支持 .csv，表头沿用「问题 / 标准话术 / 分类」</span>
            <input type="file" aria-label="导入 CSV" accept=".csv,text/csv" hidden disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setCsv(previewCsv(file.name, file.size, typeof reader.result === 'string' ? reader.result : ''));
              reader.readAsText(file);
            }} />
          </label> : <div className="file-card">
            <div className="file-row"><svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /></svg>
              <div><b>{csv.fileName}</b><span className="hint">{formatSize(csv.size)}</span></div>
              <button type="button" className="link" onClick={() => setCsv(null)}>移除</button></div>
            <div className="result">识别到 <span className="ok">{csv.count} 条话术</span>。导入后状态是未生效。</div>
            {csv.count > 0 ? <table className="mini"><thead><tr><th>问题</th><th>分类</th></tr></thead>
              <tbody>{csv.sample.map(([question, category], index) => <tr key={index}><td>{question || '—'}</td><td>{category || '—'}</td></tr>)}</tbody></table> : null}
            {csv.count > 3 ? <p className="hint" style={{ margin: '6px 0 0' }}>仅显示前 3 条</p> : null}
          </div>}
          <p className="hint alt"><button type="button" className="link" onClick={() => { setAddMode('manual'); setCsv(null); }}>没有文档？手动填写一条</button></p>
          <footer><button type="button" className="btn" onClick={() => setWriting(false)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy || !csv || csv.count === 0} onClick={() => setConfirmImport(true)}>{csv ? `导入 ${csv.count} 条` : '导入'}</button></footer>
        </> : <>
          <div className="fields">
            <label>问题<input aria-label="问题" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>分类<select aria-label="分类" value={category} onChange={(event) => setCategory(event.target.value)}>{DESK_CATEGORIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            {category === 'custom' ? <label>自定分类<input aria-label="自定分类" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} /></label> : null}
            <label>答案<textarea aria-label="答案" value={text} onChange={(event) => setText(event.target.value)} /></label>
            <div className="field-group"><span className="hint">有效期</span>
              <div className="seg" role="group" aria-label="有效期">
                {([['always', '长期生效'], ['inactive', '不生效'], ['scheduled', '定时生效']] as const).map(([value, label]) =>
                  <button key={value} type="button" aria-pressed={validity === value} onClick={() => setValidity(value)}>{label}</button>)}
              </div></div>
            {validity === 'scheduled' ? <>
              <label>开始<input aria-label="开始" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} placeholder="2026-10-13T00:00:00.000Z" /></label>
              <label>结束<input aria-label="结束" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} placeholder="2026-10-20T00:00:00.000Z" /></label>
            </> : null}
          </div>
          <p className="hint alt"><button type="button" className="link" onClick={() => setAddMode('upload')}>改为上传文档</button></p>
          <footer><button type="button" className="btn" onClick={() => setWriting(false)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply({
              action: 'upload', personaId: view.selectedPersonaId, name, category, customCategory, fileName: '问答.txt', text, validity,
              validFrom: validFrom || undefined, validUntil: validUntil || undefined,
            })}>保存</button></footer>
        </>}
      </div>
    </div> : null}
    {confirmImport && csv ? <div className="mask on" style={{ background: 'rgba(29,27,38,.14)' }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="desk-import-title">
        <header><h3 id="desk-import-title">确认导入？</h3></header>
        <p>将导入 {csv.count} 条话术，导入后状态是未生效，不会覆盖已有话术。</p>
        <footer><button type="button" className="btn" disabled={busy} onClick={() => setConfirmImport(false)}>返回</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply({
            action: 'import-csv', personaId: view.selectedPersonaId, fileName: csv.fileName, csvText: csv.csvText, category, customCategory,
          })}>{`确认导入 ${csv.count} 条`}</button></footer>
      </div>
    </div> : null}
    {pendingDelete ? <div className="mask on" onClick={(event) => { if (event.target === event.currentTarget) setPendingDelete(null); }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="desk-delete-title">
        <header><h3 id="desk-delete-title">确认删除</h3></header>
        <p className="desk-delete-copy">确定要删除吗？删除后将无法恢复。</p>
        <footer><button type="button" className="btn desk-delete-cancel" onClick={() => setPendingDelete(null)}>取消</button>
          <button type="button" className="btn btn-danger desk-delete-confirm" disabled={busy} onClick={() => {
            const id = pendingDelete;
            setPendingDelete(null);
            void apply({ action: 'remove', id });
          }}>确认删除</button></footer>
      </div>
    </div> : null}
  </section>;
}
