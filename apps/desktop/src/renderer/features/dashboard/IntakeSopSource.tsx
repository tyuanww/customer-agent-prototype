import { useEffect, useRef, useState } from 'react';
import type { SopWorkbookView } from '@shared/sop-workbook-preview';
import './workbench-v9.css';

export function IntakeSopSource() {
  const api = window.dashboardSopWorkbook;
  const [view, setView] = useState<SopWorkbookView | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const open = async () => {
    if (!api || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const reply = await api.open();
      if (!liveRef.current) return;
      if (!reply.ok) {
        if (reply.code !== 'CANCELLED') {
          setView(null);
          setSheetName('');
          setProblem(reply.message);
        }
        return;
      }
      setView(reply);
      setSheetName(reply.sheets[0]?.name ?? '');
    } catch {
      if (!liveRef.current) return;
      setView(null);
      setSheetName('');
      setProblem('这个文件读不开。');
    } finally {
      if (liveRef.current) setBusy(false);
    }
  };

  const sheet = view?.sheets.find((item) => item.name === sheetName) ?? view?.sheets[0];
  return <section className="dash-module wb9" data-testid="module-sop" aria-label="SOP">
    <h1 className="desk-sr">SOP</h1>
    {!view ? <div className="notready">还没有 SOP。</div> : null}
    {api ? <div className="toolbar">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void open()}>{busy ? '正在读取…' : '打开原始 SOP 表'}</button>
    </div> : null}
    {problem ? <p role="alert">{problem}</p> : null}
    {view ? <>
      <p className="hint">原始资料，未发布。坐席流程未切换。文件 {view.fileName}。</p>
      {!view.accepted ? <div>
        <p className="notready">这张表没有通过候选检查，没有展示半成品。</p>
        <ul>{view.issues.map((issue) => <li key={`${issue.code}-${issue.sheet}-${issue.row}`}>{issue.sheet || '文件'} 第 {issue.row} 行：{issue.fix}</li>)}</ul>
      </div> : <>
        <div className="tabbar"><div className="tabs" role="group" aria-label="SOP 工作表">
          {view.sheets.map((item) => <button key={item.name} type="button" className="tab" aria-pressed={item.name === sheet?.name} onClick={() => setSheetName(item.name)}>{item.name}</button>)}
        </div></div>
        <table className="fixed" aria-label={sheet?.name ?? 'SOP 原文'}>
          <thead><tr><th>行</th><th>原文</th></tr></thead>
          <tbody>
            {sheet?.lines.map((line) => <tr key={line.row}>
              <td>{line.row}</td>
              <td>{line.text}{line.images > 0 ? <span className="cell-sub">本行有 {line.images} 张图，未入库。</span> : null}</td>
            </tr>)}
          </tbody>
        </table>
      </>}
    </> : null}
  </section>;
}
