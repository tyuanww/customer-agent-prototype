import { createElement, useEffect, useRef, useState, type AriaAttributes, type ComponentType } from 'react';
import { Button, Empty, Image, Input, Modal, Segmented, Select, Table, Upload, type ButtonProps, type TableColumnsType, type TableProps, type UploadProps } from 'antd';
import { InboxOutlined, FileTextOutlined } from '@ant-design/icons';
import { asyncFailure } from '@shared/async-resource';
import {
  DESK_CATEGORIES,
  type DeskCommand,
  type DeskImportImage,
  type DeskItemView,
  type DeskView,
  type Validity,
} from '@shared/desk-knowledge';
import { formatShortTime } from './intake-time';
import { IntakeAntdTheme } from './intake-antd';
import { SeatDateTime } from './seat-date-time';
import './intake-management.css';
import './workbench-v9.css';
import { useAsyncResource } from './use-async-resource';
import { WorkbenchLoading } from './WorkbenchState';
import { readCoachUploadFile } from './coach-content-upload';

type CsvPreview = { fileName: string; size: number; csvText: string; images: readonly DeskImportImage[]; notices: readonly string[]; count: number; sample: ReadonlyArray<readonly [string, string]> };

const formatSize = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const EMPTY: DeskView = {
  signedIn: false, role: null, displayName: null, personas: [], selectedPersonaId: 'shop',
  items: [], delivered: [], tacit: [], revision: 0, notice: null, persistence: 'ok',
};

const UNAVAILABLE = '知识库还不能在这里用。';
const READ_FAILED = '知识库暂时读不出来。';

const VALIDITY_CHOICES: { label: string; value: Validity }[] = [
  { label: '长期生效', value: 'always' },
  { label: '不生效', value: 'inactive' },
  { label: '定时生效', value: 'scheduled' },
];

const COMMAND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function instantToLocalInput(value: string): string {
  if (!COMMAND_INSTANT.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}T${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}

function localInputToInstant(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const instant = parsed.toISOString();
  return COMMAND_INSTANT.test(instant) ? instant : undefined;
}

function isValidity(value: string | number): value is Validity {
  return VALIDITY_CHOICES.some((choice) => choice.value === value);
}

function DeskButton(props: ButtonProps) {
  return <Button {...props} autoInsertSpace={false} />;
}

function KnowledgeEmpty({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

/** Reads the dropped or picked file as text and hands it to `onFile`. antd's upload item never
 *  reaches the server on its own `action`; `beforeUpload` returning false is what keeps this a
 *  local preview, matching the dropzone it replaces. `UploadProps` doesn't declare `aria-label`,
 *  but `Upload.Dragger` forwards it to the inner `<input>` (verified against the rendered DOM) —
 *  intersecting with `AriaAttributes` types that without widening every other field to `any`. */
function useCsvDragger(
  disabled: boolean,
  onFile: (file: File) => void,
): UploadProps & Pick<AriaAttributes, 'aria-label'> {
  return {
    'aria-label': '导入 CSV 或 Excel',
    accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    multiple: false,
    disabled,
    showUploadList: false,
    openFileDialogOnClick: !disabled,
    beforeUpload: (file) => {
      if (disabled) return false;
      onFile(file);
      return false;
    },
  };
}

/** rc-table copies aria-label onto the table. antd's prop type omits it. */
function KnowledgeTable<RecordType extends object>(props: TableProps<RecordType> & { 'aria-label': string }) {
  return createElement(Table as ComponentType<typeof props>, props);
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
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'manual'>('upload');
  const [csv, setCsv] = useState<CsvPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileReading, setFileReading] = useState(false);
  const fileGeneration = useRef(0);
  const csvDragger = useCsvDragger(busy || fileReading, (file) => {
    const generation = ++fileGeneration.current;
    setFileError(null); setFileReading(true);
    void readCoachUploadFile(file).then((result) => {
      if (generation !== fileGeneration.current) return;
      if (!result.ok) { setFileError(result.message); return; }
      const usable = result.rows.filter((row) => row.scene.trim().length >= 2 && row.scene.trim().length <= 80 && row.script.trim().length <= 200_000);
      if (result.images?.some((image) => {
        const row = result.rows[image.index];
        return !row || row.scene.trim().length < 2 || row.scene.trim().length > 80 || row.script.trim().length > 200_000;
      })) { setFileError('图片所在话术无法导入，请检查该行后重试。'); return; }
      const skipped = result.sourceName.startsWith(file.name) ? result.sourceName.slice(file.name.length).replace(/^\s*·\s*/, '') : '';
      const notices = [
        ...(skipped ? [skipped] : []),
        ...(usable.length !== result.rows.length ? [`跳过 ${String(result.rows.length - usable.length)} 条问题不是 2 到 80 个字的话术。`] : []),
        ...(result.notices ?? []),
      ];
      setCsv({ fileName: file.name, size: file.size, csvText: result.csvText, images: result.images ?? [], notices, count: usable.length,
        sample: usable.slice(0, 3).map((row) => [row.scene, row.domain ?? ''] as const) });
    }).catch(() => { if (generation === fileGeneration.current) setFileError('文件读取失败，请重新选择。'); })
      .finally(() => { if (generation === fileGeneration.current) setFileReading(false); });
  });
  const [confirmImport, setConfirmImport] = useState(false);
  const closeWriting = () => { fileGeneration.current += 1; setFileReading(false); setFileError(null); setWriting(false); setConfirmImport(false); };
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('product');
  const [customCategory, setCustomCategory] = useState('');
  const [text, setText] = useState('');
  const [validity, setValidity] = useState<Validity>('always');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const consumedDraft = useRef<string | null>(null);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const { resource, reload, replace } = useAsyncResource<DeskView>(async () => {
    const generation = ++readGeneration.current;
    const report = (nextMessage: string | null) => {
      if (mounted.current && generation === readGeneration.current) setMessage(nextMessage);
    };
    const desk = window.dashboardDesk;
    if (!desk) return { status: 'forbidden', message: UNAVAILABLE };
    try {
      const reply = await desk.current();
      if (!reply.ok) {
        if (reply.view) {
          report(reply.message);
          return { status: 'ready', value: reply.view };
        }
        report(null);
        return asyncFailure<DeskView>(reply.code, { forbidden: reply.message, error: reply.message });
      }
      report(null);
      return { status: 'ready', value: reply.view };
    } catch {
      report(null);
      return { status: 'error', message: READ_FAILED };
    }
  }, [api ? 'present' : 'missing'], api ? { status: 'loading' } : { status: 'forbidden', message: UNAVAILABLE }, { retainReady: true });
  const view = resource.status === 'ready' ? resource.value : EMPTY;

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!api) return undefined;
    return window.dashboardContent?.onSessionChanged?.(reload);
  }, [api, reload]);

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
      if (reply.view) replace({ status: 'ready', value: reply.view });
      setMessage(reply.ok ? (command.action === 'import-csv' ? reply.view.notice : null) : reply.message);
      if (reply.ok && command.action === 'upload') { setName(''); setText(''); }
      if (reply.ok && command.action === 'import-csv') { setWriting(false); setCsv(null); setConfirmImport(false); }
      if (!reply.ok) setConfirmImport(false);
    } catch {
      setMessage(READ_FAILED);
    } finally {
      setBusy(false);
    }
  }

  if (resource.status === 'forbidden') {
    return <section className="desk-knowledge" aria-label="知识库"><div className="desk-column"><header className="desk-title"><h1>知识库</h1></header><p>{resource.message}</p></div></section>;
  }
  const operator = view.role === 'operator';
  const statusLine = message ?? (resource.status === 'error' ? resource.message : null);
  const emptyCopy = view.role === null
    ? (view.signedIn ? '正在读取知识库。' : '请先登录。')
    : (operator ? '还没有知识。' : '还没有生效知识。');
  const columns: TableColumnsType<DeskItemView> = [
    { title: '话术名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '话术内容', dataIndex: 'body', key: 'body', render: (body: string, item) => <div>
      <span className="desk-body" title={body}>{body}</span>
      {item.images?.length ? <Image.PreviewGroup><div className="desk-item-images">{item.images.map((image, index) =>
        <Image key={index} width={72} src={image} alt={`${item.name}的图片 ${index + 1}`} />)}</div></Image.PreviewGroup> : null}
    </div> },
    {
      title: '状态', dataIndex: 'statusLabel', key: 'status', width: 96,
      onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (label: string) => <span className="state"><i className={`dot${label === '生效中' ? ' ok' : label === '待生效' ? ' wait' : ''}`} />{label}</span>,
    },
    { title: '最后更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 120, render: (value: string) => formatShortTime(value) },
    {
      title: '操作', key: 'actions', width: 188,
      render: (_value, item) => operator ? <div className="acts">
        {item.validity !== 'always'
          ? <DeskButton type="link" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'always' })}>改为长期生效</DeskButton>
          : <DeskButton type="link" disabled={busy} onClick={() => void apply({ action: 'set-validity', id: item.id, validity: 'inactive' })}>改为不生效</DeskButton>}
        {item.parseState !== 'ok' ? <DeskButton type="link" disabled={busy} onClick={() => void apply({ action: 'retry', id: item.id })}>重试</DeskButton> : null}
        <DeskButton type="link" danger disabled={busy} onClick={() => setPendingDelete(item.id)}>删除</DeskButton>
      </div> : null,
    },
  ];
  return <IntakeAntdTheme><section className="desk-knowledge wb9" aria-label="知识库">
    <div className="desk-column">
      <h1 className="desk-sr">知识库</h1>
      <div className="tabbar">
        <div className="tabs" role="tablist" aria-label="人设">
          {view.personas.map((persona, index) => <DeskButton
            key={persona.id}
            type="text"
            role="tab"
            id={`desk-persona-${persona.id}`}
            className="tab"
            aria-selected={persona.id === view.selectedPersonaId}
            tabIndex={persona.id === view.selectedPersonaId ? 0 : -1}
            disabled={busy}
            onClick={() => void apply({ action: 'select-persona', personaId: persona.id })}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % view.personas.length
                : event.key === 'ArrowLeft' ? (index + view.personas.length - 1) % view.personas.length
                : null;
              if (next === null) return;
              event.preventDefault();
              const id = view.personas[next]!.id;
              void apply({ action: 'select-persona', personaId: id });
              document.getElementById(`desk-persona-${id}`)?.focus();
            }}
          >{persona.name}</DeskButton>)}
        </div>
        {operator ? <DeskButton type="primary" onClick={() => { setAddMode('upload'); setCsv(null); setConfirmImport(false); setWriting(true); }}>添加话术</DeskButton> : null}
      </div>
      {statusLine ? <p role="status">{statusLine}</p> : null}
      {view.notice && view.notice !== statusLine ? <p role="status">{view.notice}</p> : null}
      {resource.status === 'idle' || resource.status === 'loading' ? <WorkbenchLoading rows={5} label="正在读取知识库" /> : null}
      {resource.status === 'ready' && !(view.role === null && statusLine) ? <KnowledgeTable<DeskItemView>
        aria-label="当前人设知识"
        pagination={false}
        rowKey="id"
        tableLayout="fixed"
        dataSource={view.items}
        columns={columns}
        locale={{ emptyText: <KnowledgeEmpty description={emptyCopy} /> }}
      /> : null}
    </div>
    <Modal open={operator && writing} title="添加话术" width={520} footer={null} destroyOnHidden maskClosable transitionName="" maskTransitionName="" onCancel={closeWriting}>
        {addMode === 'upload' ? <>
          {!csv ? <Upload.Dragger
            {...csvDragger}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">拖拽文档到这里，或点击选择</p>
            <p className="ant-upload-hint">支持 CSV 或 Excel，表头可使用「快捷短语 / 产品话术」</p>
          </Upload.Dragger> : <div className="file-card">
            <div className="file-row"><FileTextOutlined className="ico" />
              <div><b>{csv.fileName}</b><span className="hint">{formatSize(csv.size)}</span></div>
              <DeskButton type="text" onClick={() => setCsv(null)}>移除</DeskButton></div>
            <div className="result">识别到 <span className="ok">{csv.count} 条话术</span>。导入后状态是未生效。</div>
            {csv.images.length ? <p>包含 {csv.images.length} 张图片，将随对应话术保存。</p> : null}
            {csv.notices.length ? <ul className="desk-import-notices" aria-label="未导入的内容">{csv.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul> : null}
            {csv.count > 0 ? <KnowledgeTable<{ key: number; question: string; category: string }>
              aria-label="导入预览"
              pagination={false}
              size="small"
              rowKey="key"
              dataSource={csv.sample.map(([question, sampleCategory], index) => ({ key: index, question: question || '—', category: sampleCategory || '—' }))}
              columns={[{ title: '问题', dataIndex: 'question' }, { title: '分类', dataIndex: 'category' }]}
            /> : null}
            {csv.count > 3 ? <p className="hint" style={{ margin: '6px 0 0' }}>仅显示前 3 条</p> : null}
          </div>}
          {fileReading ? <p role="status">正在读取文件…</p> : null}
          {fileError ? <p role="alert">{fileError}</p> : null}
          <p className="hint alt"><DeskButton type="text" onClick={() => { setAddMode('manual'); setCsv(null); }}>没有文档？手动填写一条</DeskButton></p>
          <footer><DeskButton onClick={closeWriting}>取消</DeskButton>
            <DeskButton type="primary" disabled={busy || !csv || csv.count === 0} onClick={() => setConfirmImport(true)}>{csv ? `导入 ${csv.count} 条` : '导入'}</DeskButton></footer>
        </> : <>
          <div className="fields">
            <label>问题<Input aria-label="问题" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>分类<Select<string> aria-label="分类" value={category} disabled={busy} virtual={false} style={{ width: '100%' }}
              options={DESK_CATEGORIES.map((item) => ({ value: item.code, label: item.label }))} onChange={setCategory} /></label>
            {category === 'custom' ? <label>自定分类<Input aria-label="自定分类" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} /></label> : null}
            <label>答案<Input.TextArea aria-label="答案" value={text} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => setText(event.target.value)} /></label>
            <div className="field-group"><span className="hint">有效期</span>
              <Segmented aria-label="有效期" value={validity} disabled={busy} options={VALIDITY_CHOICES} onChange={(value) => { if (isValidity(value)) setValidity(value); }} />
            </div>
            {validity === 'scheduled' ? <>
              <label>开始<SeatDateTime label="开始" placeholder="选择开始时间" value={instantToLocalInput(validFrom)} onChange={setValidFrom} disabled={busy} /></label>
              <label>结束<SeatDateTime label="结束" placeholder="选择结束时间" value={instantToLocalInput(validUntil)} onChange={setValidUntil} disabled={busy} /></label>
            </> : null}
          </div>
          <p className="hint alt"><DeskButton type="text" onClick={() => setAddMode('upload')}>改为上传文档</DeskButton></p>
          <footer><DeskButton onClick={closeWriting}>取消</DeskButton>
            <DeskButton type="primary" disabled={busy} onClick={() => void apply({
              action: 'upload', personaId: view.selectedPersonaId, name, category, customCategory, fileName: '问答.txt', text, validity,
              validFrom: localInputToInstant(validFrom), validUntil: localInputToInstant(validUntil),
            })}>保存</DeskButton></footer>
        </>}
    </Modal>
    <Modal
      open={writing && confirmImport && csv !== null}
      title="确认导入？"
      closable={false}
      maskClosable={false}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      onCancel={() => setConfirmImport(false)}
      footer={csv ? [
        <DeskButton key="back" disabled={busy} onClick={() => setConfirmImport(false)}>返回</DeskButton>,
        <DeskButton key="ok" type="primary" disabled={busy} onClick={() => void apply({
          action: 'import-csv', personaId: view.selectedPersonaId, fileName: csv.fileName, csvText: csv.csvText, images: csv.images, category, customCategory,
        })}>{`确认导入 ${csv.count} 条`}</DeskButton>,
      ] : null}
    >
      <p>将导入 {csv?.count ?? 0} 条到本机知识库，状态为未生效，不会覆盖已有话术，也不会发布到查询。</p>
    </Modal>
    <Modal
      open={pendingDelete !== null}
      title="确认删除"
      okText="确认删除"
      cancelText="取消"
      okButtonProps={{ danger: true, disabled: busy }}
      onCancel={() => setPendingDelete(null)}
      onOk={() => {
        const id = pendingDelete;
        if (!id) return;
        setPendingDelete(null);
        void apply({ action: 'remove', id });
      }}
    >
      <p className="desk-delete-copy">确定要删除吗？删除后将无法恢复。</p>
    </Modal>
  </section></IntakeAntdTheme>;
}
