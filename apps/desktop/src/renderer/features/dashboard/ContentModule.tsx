import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { type DomainId } from '../../data/dashboard-manifest';
import {
  bindingsForRows,
  contentPublishGate,
  CONTENT_PUBLISH_COPY,
  type DashboardContentDomain,
  type DashboardContentSessionView,
} from '@shared/dashboard-content';
import { StatusBadge } from './StatusBadge';
import {
  readCoachUploadFile,
  type CoachUploadResult,
  type CoachUploadRow,
} from './coach-content-upload';

const DOMAIN_LABELS: Readonly<Record<DomainId, string>> = {
  product: '产品',
  campaign: '活动',
  presale: '售前',
  aftersale: '售后',
};

const UPLOAD_COPY = {
  title: '内容导入',
  draftOnlyCopy: '上传只进入待发布，点发布后坐席才能搜到。',
  roleNote: '话术师（coach）可导入已标注的产品与活动草稿。一期发布仅管理员（owner）。售后、过敏或赔付需管理员。坐席（agent）不能发布。没有第四角色。',
  boundaryCopy: '支持 CSV 与 xlsx。中文表头会映射到场景/标准话术。不连接飞书或 Wiki。组织审核在飞书文档完成后再导入。',
  accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  readFailure: '无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。',
} as const;

const SESSION_BANNER_FULL = '导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。';
const SESSION_BANNER_SHORT = '导入与发布走产品会话';
const CANCEL_ARIA_LABEL = '取消服务器上未完成的导入，不影响本页预览';

type UploadView =
  | { status: 'idle' }
  | { status: 'reading'; sourceName: string }
  | { status: 'ready'; sourceName: string; rows: readonly CoachUploadRow[]; csvText: string }
  | { status: 'error'; message: string; sourceName?: string };

function domainLabel(domain: DomainId | undefined): string {
  if (!domain) return '未标注';
  return DOMAIN_LABELS[domain];
}

const DOMAIN_OPTIONS: readonly { value: DashboardContentDomain; label: string }[] = [
  { value: 'product', label: '产品' },
  { value: 'campaign', label: '活动' },
  { value: 'presale', label: '售前' },
  { value: 'aftersale', label: '售后' },
];

/** Same rows, relabelled to one chosen domain. Used when the file name guesses wrong. */
function withDomain(rows: readonly CoachUploadRow[], domain: DashboardContentDomain): readonly CoachUploadRow[] {
  return rows.map((row) => ({ scene: row.scene, script: row.script, domain }));
}

function applyUploadResult(result: CoachUploadResult, sourceName: string): UploadView {
  if (result.ok) {
    return { status: 'ready', sourceName: result.sourceName, rows: result.rows, csvText: result.csvText };
  }
  return { status: 'error', message: result.message, sourceName };
}

function uploadRows(upload: UploadView): readonly CoachUploadRow[] {
  return upload.status === 'ready' ? upload.rows : [];
}

function uploadCsvText(upload: UploadView): string {
  return upload.status === 'ready' ? upload.csvText : '';
}

function uploadSourceName(upload: UploadView): string {
  return upload.status === 'ready' ? upload.sourceName : '';
}

/** `待开发` summary: the only status source once the body is collapsed. */
function summarizeUpload(upload: UploadView): { text: string; title: string } {
  if (upload.status === 'reading') {
    return { text: `待开发 · 正在读取 ${upload.sourceName}`, title: `待开发 · 正在读取 ${upload.sourceName}` };
  }
  if (upload.status === 'ready') {
    const text = `待开发 · ${upload.sourceName} · 待发布 ${upload.rows.length} 行`;
    return { text, title: text };
  }
  if (upload.status === 'error') {
    const text = upload.sourceName
      ? `待开发 · 未进入待发布 · ${upload.sourceName}`
      : '待开发 · 未进入待发布';
    return { text, title: upload.message };
  }
  return { text: '待开发 · 内容导入', title: '待开发 · 内容导入' };
}

type SessionState = 'pending' | 'signed-in' | 'disconnected';

export function ContentModule() {
  const [upload, setUpload] = useState<UploadView>({ status: 'idle' });
  const [sessionView, setSessionView] = useState<DashboardContentSessionView | null>(null);
  const [sessionSettled, setSessionSettled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const [publishSucceededThisRound, setPublishSucceededThisRound] = useState(false);
  const [domainOverride, setDomainOverride] = useState<DashboardContentDomain | ''>('');
  const [pendingDevOpen, setPendingDevOpen] = useState(false);
  const ingestGeneration = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadStatusRef = useRef<UploadView['status']>('idle');
  const hasProductApi = typeof window !== 'undefined' && Boolean(window.dashboardContent);
  const effectiveUpload: UploadView = domainOverride !== '' && upload.status === 'ready'
    ? { ...upload, rows: withDomain(upload.rows, domainOverride) }
    : upload;
  const hasDomain = effectiveUpload.status === 'ready' && effectiveUpload.rows.some((row) => row.domain);
  const statusMessage = effectiveUpload.status === 'ready'
    ? `待发布 · ${effectiveUpload.rows.length} 行 · ${effectiveUpload.sourceName} · 不是已发布`
    : effectiveUpload.status === 'reading'
      ? `正在读取 ${effectiveUpload.sourceName} · 只在本页预览，不会发布`
      : effectiveUpload.status === 'error'
        ? effectiveUpload.message
        : '尚未导入。选择 CSV 或 xlsx；中文表头（快捷短语/产品话术）会映射到场景与标准话术。空白行会跳过。';
  const summary = summarizeUpload(upload);

  useEffect(() => {
    const api = window.dashboardContent;
    if (!api) return undefined;
    let live = true;
    const load = () => {
      void api.session().then((result) => {
        if (!live) return;
        setSessionView(result.ok ? result : null);
        setSessionSettled(true);
      }).catch(() => {
        if (!live) return;
        setSessionView(null);
        setSessionSettled(true);
      });
    };
    load();
    // Focus refresh keeps the last painted view until the new result lands.
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  // Auto-open only on a transition into a state the operator must see. A user
  // who collapses a ready preview stays collapsed across re-renders.
  useEffect(() => {
    const previous = uploadStatusRef.current;
    uploadStatusRef.current = upload.status;
    if (previous === upload.status) return;
    if (upload.status === 'reading' || upload.status === 'ready' || upload.status === 'error') {
      setPendingDevOpen(true);
    }
  }, [upload.status]);

  const rows = uploadRows(effectiveUpload);
  const sourceBindings = bindingsForRows(rows);
  const gate = contentPublishGate({
    productAvailable: hasProductApi && sessionView?.enabled !== false,
    signedIn: sessionView?.signedIn === true,
    role: sessionView?.role ?? null,
    rows,
    sourceBindings,
  });
  const publishDisabled = !gate.allowed || submitting || upload.status !== 'ready' || publishSucceededThisRound;
  const gateBlocksHard = !gate.allowed && gate.code !== 'VALIDATION';
  const publishReason = submitting
    ? CONTENT_PUBLISH_COPY.submitting
    : gateBlocksHard
      ? gate.message
      : upload.status === 'idle' || upload.status === 'error'
        ? '请先导入草稿'
        : upload.status === 'reading'
          ? '正在读取文件'
          : gate.allowed
            ? ''
            : gate.message;

  const sessionState: SessionState = !hasProductApi
    ? 'disconnected'
    : !sessionSettled
      ? 'pending'
      : sessionView?.enabled !== false && sessionView?.signedIn === true
        ? 'signed-in'
        : 'disconnected';
  const sessionBadge = sessionState === 'pending'
    ? { label: '正在确认会话', tone: 'neutral' as const }
    : sessionState === 'signed-in'
      ? { label: '已接入', tone: 'ok' as const }
      : { label: '未接入', tone: 'warn' as const };
  const bannerText = sessionState === 'signed-in' ? SESSION_BANNER_SHORT : SESSION_BANNER_FULL;

  const clearUpload = () => {
    ingestGeneration.current += 1;
    setPublishFeedback(null);
    setPublishSucceededThisRound(false);
    setDomainOverride('');
    setPendingDevOpen(false);
    setUpload({ status: 'idle' });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const generation = ingestGeneration.current + 1;
    ingestGeneration.current = generation;
    const sourceName = file.name.trim() || 'untitled.csv';
    setPublishFeedback(null);
    setPublishSucceededThisRound(false);
    setDomainOverride('');
    setUpload({ status: 'reading', sourceName });
    void readCoachUploadFile(file).then(
      (result) => {
        if (generation !== ingestGeneration.current) return;
        setUpload(applyUploadResult(result, sourceName));
      },
      () => {
        if (generation !== ingestGeneration.current) return;
        setUpload({ status: 'error', message: UPLOAD_COPY.readFailure, sourceName });
      },
    );
  };

  // The cancel sweep is the in-flight escape hatch, so submitting must not grey it.
  const cancelDisabled = sessionView?.signedIn !== true;

  const onCancelInFlight = () => {
    if (cancelDisabled) return;
    const api = window.dashboardContent;
    if (!api?.cancelInFlight) {
      setPublishFeedback('当前没有产品会话，无法取消导入');
      return;
    }
    void api.cancelInFlight().then((result) => {
      setPublishFeedback(result.ok ? '已取消未完成的导入，可以重新导入' : result.message);
    });
  };

  const onPublish = () => {
    if (publishDisabled || upload.status !== 'ready' || submitting) return;
    const api = window.dashboardContent;
    if (!api) return;
    const generation = ingestGeneration.current;
    setSubmitting(true);
    setPublishFeedback(null);
    const sourceName = uploadSourceName(upload);
    const csvText = uploadCsvText(upload);
    const title = sourceName.trim().slice(0, 200) || '工作台草稿';
    void api.publishDraft({
      sourceName,
      csvText,
      rows,
      title,
      summary: null,
      sourceBindings,
    }).then((result) => {
      if (generation !== ingestGeneration.current) return;
      if (!result.ok) {
        setPublishFeedback(result.message);
        return;
      }
      setPublishSucceededThisRound(true);
      const who = result.publisherDisplayName ?? sessionView?.displayName;
      setPublishFeedback(who
        ? `已发布 ${result.releaseId} · ${who}`
        : `已发布 ${result.releaseId}`);
    }).catch(() => {
      if (generation !== ingestGeneration.current) return;
      setPublishFeedback('服务暂不可用，请重试');
    }).finally(() => {
      if (generation === ingestGeneration.current) setSubmitting(false);
    });
  };

  return (
    <div className="dash-module" data-testid="module-content">
      <header className="dash-module-head">
        <div className="content-title-cluster">
          <h1>内容管理</h1>
          <span className="content-session-badge" data-testid="content-session-badge">
            <StatusBadge label={sessionBadge.label} tone={sessionBadge.tone} />
          </span>
          <p className="content-session-banner" data-testid="formal-source-warning" title={SESSION_BANNER_FULL}>
            {bannerText}
          </p>
        </div>
        <div className="dash-publish-box">
          <div className="content-action-row">
            <button
              type="button"
              className="dash-reset"
              data-testid="cancel-in-flight"
              aria-label={CANCEL_ARIA_LABEL}
              disabled={cancelDisabled}
              onClick={onCancelInFlight}
            >
              取消未完成导入
            </button>
            <button
              type="button"
              className="dash-publish"
              disabled={publishDisabled}
              data-testid="publish-action"
              aria-describedby="content-publish-note"
              onClick={onPublish}
            >
              发布
            </button>
          </div>
          <span id="content-publish-note" className="content-publish-note">
            {publishFeedback ? (
              <span role="status" aria-live="polite" data-testid="publish-feedback">{publishFeedback}</span>
            ) : (
              <span data-testid="publish-disabled-reason">{publishReason}</span>
            )}
          </span>
        </div>
      </header>

      <details
        className="dash-contract-details"
        data-testid="content-pending-dev"
        open={pendingDevOpen}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          if (next !== pendingDevOpen) setPendingDevOpen(next);
        }}
      >
        <summary title={summary.title}>{summary.text}</summary>
        <div className="content-upload" data-testid="content-upload-panel">

          <div className="dash-filter-toolbar compact content-upload-controls" aria-label="内容导入">
            <input
              ref={fileInputRef}
              id="content-upload-file"
              type="file"
              accept={UPLOAD_COPY.accept}
              data-testid="content-upload-input"
              hidden
              disabled={upload.status === 'reading' || submitting}
              onChange={onFileChange}
            />
            <button
              type="button"
              className="dash-reset"
              data-testid="content-upload-pick"
              aria-label="选择 CSV 或 xlsx"
              disabled={upload.status === 'reading' || submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              选择 CSV 或 xlsx
            </button>
            {upload.status === 'ready' || upload.status === 'reading' ? (
              <span data-testid="content-upload-filename">
                {upload.status === 'reading' ? upload.sourceName : uploadSourceName(upload)}
              </span>
            ) : null}
            <button
              type="button"
              className="dash-reset"
              data-testid="content-upload-clear"
              disabled={upload.status === 'idle' || upload.status === 'reading' || submitting}
              onClick={clearUpload}
            >
              清除预览
            </button>
          </div>

          <div
            className="content-upload-status"
            role="status"
            aria-live="polite"
            data-state={upload.status}
            data-testid="content-upload-status"
          >
            <strong>{
              upload.status === 'ready'
                ? '待发布'
                : upload.status === 'reading'
                  ? '正在读取'
                  : upload.status === 'error'
                    ? '未进入待发布'
                    : '等待导入'
            }</strong>
            <span>{statusMessage}</span>
          </div>

          {upload.status === 'ready' ? (
            <div className="dash-filter-toolbar compact content-domain-picker" aria-label="归属话术库">
              <label htmlFor="content-domain-override">归属话术库</label>
              <span data-testid="content-domain-detected">
                {hasDomain ? `表里识别到：${[...new Set(rows.map((row) => row.domain))].map(domainLabel).join('、')}` : '表里没有域列'}
              </span>
              <select
                id="content-domain-override"
                data-testid="content-domain-override"
                value={domainOverride}
                disabled={submitting}
                onChange={(event) => {
                  setDomainOverride(event.currentTarget.value as DashboardContentDomain | '');
                }}
              >
                <option value="">按表里的域</option>
                {DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="dash-scope">
                选错库不会报错但会传错区。这张表实际属于哪个话术库，就在这里确认。
              </span>
            </div>
          ) : null}

          {upload.status === 'ready' ? (
            <div className="dash-table-wrap content-staged-preview" data-testid="content-staged-preview">
              <table className="dash-table">
                <caption>待发布预览 · 场景 / 标准话术</caption>
                <thead>
                  <tr>
                    {hasDomain ? <th>域</th> : null}
                    <th>场景</th>
                    <th>标准话术</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.scene}-${index}`}>
                      {hasDomain ? <td>{domainLabel(row.domain)}</td> : null}
                      <td>{row.scene}</td>
                      <td>{row.script}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="content-upload-copy">
            <span className="dash-card-label">{UPLOAD_COPY.title}</span>
            <h2 id="content-upload-title">本地导入进入待发布</h2>
            <p data-testid="content-upload-draft-copy">{UPLOAD_COPY.draftOnlyCopy}</p>
            <p data-testid="content-upload-role-note">{UPLOAD_COPY.roleNote}</p>
            <p data-testid="content-upload-boundary">{UPLOAD_COPY.boundaryCopy}</p>
            <p data-testid="content-aftersale-note">售后 SOP 写库未接入，本页不展开合成树。</p>
          </div>
        </div>
      </details>
    </div>
  );
}
