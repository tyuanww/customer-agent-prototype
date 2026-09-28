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
import { LIBRARY_DOMAINS, composeLibraryDelta } from '@shared/library-delta';

const DOMAIN_LABELS: Readonly<Record<DomainId, string>> = {
  product: '产品',
  campaign: '活动',
  presale: '售前',
  aftersale: '售后',
};

const UPLOAD_COPY = {
  draftOnlyCopy: '选表只预览，点发布后坐席才能搜到。',
  accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  readFailure: '无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。',
} as const;

const SESSION_BANNER_FULL = '导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。';
const REPLACE_HINT = '必须手选要换的库。发布会整库替换这一库，其它库沿用。';
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

function detectedDomainCopy(upload: UploadView): string | null {
  if (upload.status !== 'ready') return null;
  const labels = [...new Set(
    upload.rows
      .map((row) => row.domain)
      .filter((domain): domain is DashboardContentDomain => Boolean(domain)),
  )].map(domainLabel);
  if (labels.length === 0) return '表里没有域列';
  return `表里识别到：${labels.join('、')}`;
}

type SessionState = 'pending' | 'signed-in' | 'disconnected';

function uploadStatusHeadline(status: UploadView['status']): string {
  if (status === 'ready') return '待发布';
  if (status === 'reading') return '正在读取';
  if (status === 'error') return '未进入待发布';
  return '等待导入';
}

function uploadStatusDetail(upload: UploadView): string {
  if (upload.status === 'ready') {
    return `待发布 · ${upload.rows.length} 行 · ${upload.sourceName} · 不是已发布`;
  }
  if (upload.status === 'reading') {
    return `正在读取 ${upload.sourceName} · 只在本页预览，不会发布`;
  }
  if (upload.status === 'error') return upload.message;
  return '选择 CSV 或 xlsx';
}

function sessionStateOf(
  hasProductApi: boolean,
  sessionSettled: boolean,
  sessionView: DashboardContentSessionView | null,
): SessionState {
  if (!hasProductApi) return 'disconnected';
  if (!sessionSettled) return 'pending';
  if (sessionView?.enabled !== false && sessionView?.signedIn === true) return 'signed-in';
  return 'disconnected';
}

function sessionBadgeOf(state: SessionState): { label: string; tone: 'neutral' | 'ok' | 'warn' } {
  if (state === 'pending') return { label: '正在确认会话', tone: 'neutral' };
  if (state === 'signed-in') return { label: '已接入', tone: 'ok' };
  return { label: '未接入', tone: 'warn' };
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
  const statusMessage = uploadStatusDetail(effectiveUpload);
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
  const needsLibraryPick = domainOverride === '';
  const publishDisabled = !gate.allowed || submitting || upload.status !== 'ready'
    || publishSucceededThisRound || needsLibraryPick;
  let publishReason = '';
  if (submitting) publishReason = CONTENT_PUBLISH_COPY.submitting;
  else if (!gate.allowed) publishReason = gate.message;
  else if (upload.status === 'idle' || upload.status === 'error') publishReason = '请先导入草稿';
  else if (upload.status === 'reading') publishReason = '正在读取文件';
  else if (needsLibraryPick) publishReason = '请选择将替换哪一库';

  const sessionState = sessionStateOf(hasProductApi, sessionSettled, sessionView);
  const sessionBadge = sessionBadgeOf(sessionState);
  const replaceDetected = detectedDomainCopy(upload);

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
    // 四库 delta：本批绑定的域 = 本版已更新；其余 = 本版沿用。与 service 写入
    // Announcement.summary 的是同一句，回执第二行直接显示它。
    const bindingDomains = new Set(sourceBindings.map((binding) => binding.domain));
    const delta = composeLibraryDelta(
      LIBRARY_DOMAINS.filter((domain) => bindingDomains.has(domain)).map((domain) => ({ domain, count: null })),
    );
    void api.publishDraft({
      sourceName,
      csvText,
      rows,
      title,
      summary: delta,
      sourceBindings,
    }).then((result) => {
      if (generation !== ingestGeneration.current) return;
      if (!result.ok) {
        // 失败不说替换，也不画 delta。
        setPublishFeedback(result.message);
        return;
      }
      setPublishSucceededThisRound(true);
      const who = result.publisherDisplayName ?? sessionView?.displayName;
      const headline = who ? `已发布 ${result.releaseId} · ${who}` : `已发布 ${result.releaseId}`;
      setPublishFeedback(result.summary ? `${headline}\n${result.summary}` : headline);
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
          <span
            className="content-session-badge"
            data-testid="content-session-badge"
            title={SESSION_BANNER_FULL}
          >
            <StatusBadge label={sessionBadge.label} tone={sessionBadge.tone} />
          </span>
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
              <span role="status" aria-live="polite" className="content-publish-feedback" data-testid="publish-feedback">
                {publishFeedback.includes('\n')
                  ? publishFeedback.split('\n').map((line, index) => (
                    <span
                      key={`${line}-${index}`}
                      className={index === 0 ? 'content-publish-headline' : 'content-publish-delta'}
                      data-testid={index === 0 ? 'publish-feedback-headline' : 'publish-feedback-delta'}
                    >
                      {line}
                    </span>
                  ))
                  : publishFeedback}
              </span>
            ) : (
              <span data-testid="publish-disabled-reason">{publishReason}</span>
            )}
          </span>
        </div>
      </header>

      <div className="dash-filter-toolbar compact content-replace-row" data-testid="content-replace-row">
        <label htmlFor="content-domain-override">将替换</label>
        <select
          id="content-domain-override"
          data-testid="content-domain-override"
          value={domainOverride}
          disabled={submitting}
          onChange={(event) => {
            setDomainOverride(event.currentTarget.value as DashboardContentDomain | '');
          }}
        >
          <option value="">选择话术库</option>
          {DOMAIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {replaceDetected ? (
          <span data-testid="content-domain-detected">{replaceDetected}</span>
        ) : null}
        <span className="dash-scope">{REPLACE_HINT}</span>
      </div>

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
        <div className="content-upload" data-testid="content-upload-panel" role="group" aria-label="内容导入">

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
            <strong>{uploadStatusHeadline(upload.status)}</strong>
            <span>{statusMessage}</span>
          </div>

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

          <p data-testid="content-upload-draft-copy" className="content-upload-draft">
            {UPLOAD_COPY.draftOnlyCopy}
          </p>
        </div>
      </details>
    </div>
  );
}
