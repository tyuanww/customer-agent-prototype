import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Empty, Select, Table, type TableColumnsType } from 'antd';
import { type DashboardModuleId, type DomainId } from '../../data/dashboard-manifest';
import {
  bindingsForRows,
  contentPublishGate,
  CONTENT_PUBLISH_COPY,
  CONTENT_ROLLBACK_COPY,
  type ContentPublishGate,
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

const SESSION_BANNER_FULL = '导入与发布走产品会话。没有会话时先登录，不会写入假发布。';
const LOGIN_BEFORE_PUBLISH = '请先登录后再发布。';
const PREVIEW_EMPTY = '请先选择 CSV 或 xlsx。';
const REPLACE_HINT = '必须手选要换的库。发布会整库替换这一库，其它库沿用。';
const CANCEL_ARIA_LABEL = '取消服务器上未完成的导入，不影响本页预览';
const ROLLBACK_ARIA_LABEL = '把上一个已发布版本重新发布为当前版本，不改动任何草稿';

function uniqueRowDomains(rows: readonly CoachUploadRow[]): DashboardContentDomain[] {
  const seen: DashboardContentDomain[] = [];
  for (const row of rows) {
    if (!row.domain || seen.includes(row.domain)) continue;
    seen.push(row.domain);
  }
  return seen;
}

function replaceMismatchesPick(
  detected: readonly DashboardContentDomain[],
  pick: DashboardContentDomain | '',
): boolean {
  if (pick === '' || detected.length === 0) return false;
  return detected.length !== 1 || detected[0] !== pick;
}

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

function DetectedDomainLine({ upload }: { upload: UploadView }) {
  if (upload.status !== 'ready') return null;
  const domains = uniqueRowDomains(upload.rows);
  return (
    <div className="content-detected" data-testid="content-domain-detected">
      <p className="content-detected-title">表里识别到</p>
      <p className="content-detected-values">
        {domains.length === 0 ? '表里没有域列' : domains.map((domain, index) => (
          <span key={domain}>
            {index > 0 ? '、' : null}
            {domain === 'aftersale'
              ? <strong data-testid="content-detected-aftersale">{domainLabel(domain)}</strong>
              : domainLabel(domain)}
          </span>
        ))}
      </p>
      <p className="content-detected-hint">{REPLACE_HINT}</p>
    </div>
  );
}

type SeatNotice =
  | { kind: 'text'; text: string }
  | { kind: 'published'; delta: string | null; releaseId: string };

type PreviewLine = {
  key: string;
  domain: string;
  scene: string;
  script: string;
};

function previewColumn(title: string, dataIndex: keyof PreviewLine): TableColumnsType<PreviewLine>[number] {
  if (title !== '待处理') return { title, dataIndex };
  const nowrap = () => ({ style: { whiteSpace: 'nowrap' as const } });
  return { title, dataIndex, width: 88, onCell: nowrap, onHeaderCell: nowrap };
}

function textNotice(text: string): SeatNotice {
  return { kind: 'text', text };
}

function seatBlockedReason(gate: ContentPublishGate): string {
  if (gate.allowed) return '';
  if (gate.code === 'UNAVAILABLE' || gate.code === 'UNAUTHORIZED') return LOGIN_BEFORE_PUBLISH;
  return gate.message;
}

function PublishReceiptView({ notice }: { notice: SeatNotice }): ReactNode {
  if (notice.kind === 'published') {
    return (
      <>
        <span className="content-publish-headline" data-testid="publish-feedback-headline">已发布。</span>
        {notice.delta ? (
          <span className="content-publish-delta" data-testid="publish-feedback-delta">{notice.delta}</span>
        ) : null}
        <span className="content-publish-release">发布号 {notice.releaseId}</span>
      </>
    );
  }
  if (!notice.text.includes('\n')) return notice.text;
  return notice.text.split('\n').map((line, index) => (
    <span
      key={`${index}-${line}`}
      className={index === 0 ? 'content-publish-headline' : 'content-publish-delta'}
      data-testid={index === 0 ? 'publish-feedback-headline' : undefined}
    >
      {line}
    </span>
  ));
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
  return { label: '请先登录', tone: 'warn' };
}

function summarizeUpload(upload: UploadView): { text: string; title: string } {
  if (upload.status === 'reading') {
    return { text: `正在读取 ${upload.sourceName}`, title: `正在读取 ${upload.sourceName}` };
  }
  if (upload.status === 'ready') {
    const text = `${upload.sourceName} · 待发布 ${upload.rows.length} 行`;
    return { text, title: text };
  }
  if (upload.status === 'error') {
    const text = upload.sourceName
      ? `未进入待发布 · ${upload.sourceName}`
      : '未进入待发布';
    return { text, title: upload.message };
  }
  return { text: '内容导入', title: '内容导入' };
}

export function ContentModule({
  onNavigate,
  onOpenWordingDomain,
}: {
  onNavigate?: (target: Extract<DashboardModuleId, 'announce' | 'wording'>) => void;
  onOpenWordingDomain?: (domain: DomainId) => void;
} = {}) {
  const [upload, setUpload] = useState<UploadView>({ status: 'idle' });
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [sessionView, setSessionView] = useState<DashboardContentSessionView | null>(null);
  const [sessionSettled, setSessionSettled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<SeatNotice | null>(null);
  const [publishSucceededThisRound, setPublishSucceededThisRound] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [domainOverride, setDomainOverride] = useState<DashboardContentDomain | ''>('');
  const [publishPhase, setPublishPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const ingestGeneration = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    window.addEventListener('focus', load);
    const stopSession = api.onSessionChanged?.(load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      stopSession?.();
    };
  }, []);

  const rows = uploadRows(effectiveUpload);
  const previewLines: PreviewLine[] = rows.map((row, index) => ({
    key: `${row.scene}-${index}`,
    domain: domainLabel(row.domain),
    scene: row.scene,
    script: row.script,
  }));
  const sourceBindings = bindingsForRows(rows);
  const gate = contentPublishGate({
    productAvailable: hasProductApi && sessionView?.enabled !== false,
    signedIn: sessionView?.signedIn === true,
    role: sessionView?.role ?? null,
    job: sessionView?.job ?? null,
    rows,
    sourceBindings,
  });
  const needsLibraryPick = domainOverride === '';
  const detectedDomains = uniqueRowDomains(uploadRows(upload));
  const mismatchReplace = replaceMismatchesPick(detectedDomains, domainOverride);
  const gateBlocked = !gate.allowed || submitting || upload.status !== 'ready'
    || publishSucceededThisRound || needsLibraryPick;
  const publishDisabled = gateBlocked || replaceConfirm;
  let publishReason = '';
  if (submitting) publishReason = CONTENT_PUBLISH_COPY.submitting;
  else if (!gate.allowed) publishReason = seatBlockedReason(gate);
  else if (upload.status === 'idle' || upload.status === 'error') publishReason = '请先导入草稿';
  else if (upload.status === 'reading') publishReason = '正在读取文件';
  else if (needsLibraryPick) publishReason = '请选择将替换哪一库';
  else if (replaceConfirm) publishReason = '';

  const sessionState = sessionStateOf(hasProductApi, sessionSettled, sessionView);
  const sessionBadge = sessionBadgeOf(sessionState);
  const clearUpload = () => {
    ingestGeneration.current += 1;
    setNotice(null);
    setPublishSucceededThisRound(false);
    setPublishPhase('idle');
    setDomainOverride('');
    setReplaceConfirm(false);
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
    setNotice(null);
    setPublishSucceededThisRound(false);
    setPublishPhase('idle');
    setDomainOverride('');
    setReplaceConfirm(false);
    setUpload({ status: 'reading', sourceName });
    void readCoachUploadFile(file).then(
      (result) => {
        if (generation !== ingestGeneration.current) return;
        const next = applyUploadResult(result, sourceName);
        setUpload(next);
      },
      () => {
        if (generation !== ingestGeneration.current) return;
        setUpload({ status: 'error', message: UPLOAD_COPY.readFailure, sourceName });
      },
    );
  };

  // The cancel sweep is the in-flight escape hatch, so submitting must not grey it.
  const cancelDisabled = sessionView?.signedIn !== true;
  const rollbackDisabled = sessionView?.signedIn !== true
    || sessionView?.role !== 'owner'
    || sessionView.job?.status !== 'resolved'
    || sessionView.job.rights.grant !== true
    || rollbackBusy
    || submitting;

  const onRollbackPrevious = () => {
    if (rollbackDisabled) return;
    if (!rollbackConfirm) {
      setRollbackConfirm(true);
      return;
    }
    const api = window.dashboardContent;
    if (!api?.rollbackPrevious) {
      setNotice(textNotice('请先登录后再回退。'));
      return;
    }
    const generation = ingestGeneration.current;
    setRollbackBusy(true);
    setRollbackConfirm(false);
    setNotice(null);
    void api.rollbackPrevious().then((result) => {
      if (generation !== ingestGeneration.current) return;
      if (!result.ok) {
        // The API answers NOT_FOUND when nothing older exists; product-http maps 404 to GONE on
        // the way back, so GONE is this endpoint's "no previous release" signal. Leaving the
        // shared error vocabulary alone is worth the one local mapping.
        setNotice(textNotice(result.code === 'GONE' ? CONTENT_ROLLBACK_COPY.noPrevious : result.message));
        return;
      }
      setNotice(textNotice(`已回到上一版。\n发布号 ${result.releaseId}，上一版 ${result.rollbackOfReleaseId}`));
      setPublishSucceededThisRound(true);
    }).catch(() => {
      if (generation !== ingestGeneration.current) return;
      setNotice(textNotice('服务暂不可用，请重试'));
    }).finally(() => {
      if (generation === ingestGeneration.current) setRollbackBusy(false);
    });
  };

  const onCancelInFlight = () => {
    if (cancelDisabled) return;
    const api = window.dashboardContent;
    if (!api?.cancelInFlight) {
      setNotice(textNotice('当前没有产品会话，无法取消导入'));
      return;
    }
    void api.cancelInFlight().then((result) => {
      setNotice(textNotice(result.ok ? '已取消未完成的导入，可以重新导入' : result.message));
    });
  };

  const submitPublish = () => {
    if (gateBlocked || upload.status !== 'ready' || submitting) return;
    const api = window.dashboardContent;
    if (!api) return;
    const generation = ingestGeneration.current;
    setSubmitting(true);
    setPublishPhase('busy');
    setReplaceConfirm(false);
    setNotice(null);
    const sourceName = uploadSourceName(upload);
    const csvText = uploadCsvText(upload);
    const title = sourceName.trim().slice(0, 200) || '工作台草稿';
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
        setPublishPhase('idle');
        setNotice(textNotice(result.message));
        return;
      }
      setPublishSucceededThisRound(true);
      setPublishPhase('done');
      setNotice({ kind: 'published', delta: result.summary, releaseId: result.releaseId });
    }).catch(() => {
      if (generation !== ingestGeneration.current) return;
      setPublishPhase('idle');
      setNotice(textNotice('服务暂不可用，请重试'));
    }).finally(() => {
      if (generation === ingestGeneration.current) setSubmitting(false);
    });
  };

  const onPublish = () => {
    if (gateBlocked || upload.status !== 'ready' || submitting) return;
    if (mismatchReplace && !replaceConfirm) {
      setReplaceConfirm(true);
      return;
    }
    submitPublish();
  };

  return (
    <div className={`dash-module content-stage${publishPhase !== 'idle' ? ' is-publishing' : ''}`} data-testid="module-content">
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
            <Button
              autoInsertSpace={false}
              data-testid="content-rollback-previous"
              aria-label={ROLLBACK_ARIA_LABEL}
              disabled={rollbackDisabled}
              onClick={onRollbackPrevious}
            >
              回滚上一版
            </Button>
            <Button
              autoInsertSpace={false}
              data-testid="cancel-in-flight"
              aria-label={CANCEL_ARIA_LABEL}
              disabled={cancelDisabled}
              onClick={onCancelInFlight}
            >
              取消未完成导入
            </Button>
            <Button
              autoInsertSpace={false}
              type="primary"
              disabled={publishDisabled}
              data-testid="publish-action"
              aria-describedby="content-publish-note"
              onClick={onPublish}
            >
              发布
            </Button>
          </div>
          <span id="content-publish-note" className="content-publish-note">
            {notice ? (
              <span role="status" aria-live="polite" className="content-publish-feedback" data-testid="publish-feedback">
                <PublishReceiptView notice={notice} />
                {publishSucceededThisRound ? (
                  <span className="content-publish-links" data-testid="publish-feedback-links">
                    <Button
                      autoInsertSpace={false}
                      type="text"
                      data-testid="publish-goto-announce"
                      onClick={() => onNavigate?.('announce')}
                    >
                      去系统同步
                    </Button>
                    <Button
                      autoInsertSpace={false}
                      type="text"
                      data-testid="publish-goto-wording"
                      onClick={() => {
                        if (domainOverride) onOpenWordingDomain?.(domainOverride);
                      }}
                    >
                      去话术库
                    </Button>
                  </span>
                ) : null}
              </span>
            ) : (
              <span data-testid="publish-disabled-reason">{publishReason}</span>
            )}
          </span>
        </div>
      </header>

      <div className="dash-filter-toolbar compact content-replace-row" data-testid="content-replace-row">
        <label htmlFor="content-domain-override">将替换</label>
        <Select<DashboardContentDomain>
          id="content-domain-override"
          data-testid="content-domain-override"
          aria-label="将替换"
          value={domainOverride || undefined}
          placeholder="选择话术库"
          disabled={submitting}
          virtual={false}
          style={{ minWidth: 140 }}
          options={[...DOMAIN_OPTIONS]}
          onChange={(value) => {
            setReplaceConfirm(false);
            setDomainOverride(value);
          }}
        />
        <DetectedDomainLine upload={upload} />
      </div>
      {publishPhase !== 'idle' ? (
        <div className="content-publish-veil" data-testid="content-publish-veil" role="status">
          <p className="content-publish-toast" data-testid="content-publish-toast">
            {publishPhase === 'busy' ? '发布中' : '已发布'}
          </p>
        </div>
      ) : null}
      {replaceConfirm ? (
        <div className="content-replace-confirm" data-testid="content-replace-confirm" role="status">
          <span>
            {`表里识别到${detectedDomains.map(domainLabel).join('、')}，将整库替换「${domainLabel(domainOverride || undefined)}」。确认后才发布。`}
          </span>
          <span className="content-action-row">
            <Button
              autoInsertSpace={false}
              data-testid="content-replace-confirm-cancel"
              onClick={() => setReplaceConfirm(false)}
            >
              取消
            </Button>
            <Button
              autoInsertSpace={false}
              type="primary"
              data-testid="content-replace-confirm-action"
              disabled={submitting}
              onClick={submitPublish}
            >
              确认发布
            </Button>
          </span>
        </div>
      ) : null}

      {rollbackConfirm ? (
        <div className="content-replace-confirm" data-testid="content-rollback-confirm" role="status">
          <span>把上一个已发布版本重新发布为当前版本。这会新增一个版本，已有版本不会被删除。确认后才回滚。</span>
          <span className="content-action-row">
            <Button
              autoInsertSpace={false}
              data-testid="content-rollback-confirm-cancel"
              onClick={() => setRollbackConfirm(false)}
            >
              取消
            </Button>
            <Button
              autoInsertSpace={false}
              type="primary"
              data-testid="content-rollback-confirm-action"
              disabled={rollbackBusy}
              onClick={onRollbackPrevious}
            >
              确认回滚
            </Button>
          </span>
        </div>
      ) : null}

      <section className="dash-contract-details" data-testid="content-pending-dev">
        <h2 className="content-import-heading">{summary.text}</h2>
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
            <Button
              autoInsertSpace={false}
              data-testid="content-upload-pick"
              aria-label="选择 CSV 或 xlsx"
              disabled={upload.status === 'reading' || submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              选择 CSV 或 xlsx
            </Button>
            {upload.status === 'ready' || upload.status === 'reading' ? (
              <span data-testid="content-upload-filename">
                {upload.status === 'reading' ? upload.sourceName : uploadSourceName(upload)}
              </span>
            ) : null}
            <Button
              autoInsertSpace={false}
              data-testid="content-upload-clear"
              disabled={upload.status === 'idle' || upload.status === 'reading' || submitting}
              onClick={clearUpload}
            >
              清除预览
            </Button>
          </div>

          <div
            className="content-upload-status"
            role="status"
            aria-live="polite"
            data-state={upload.status}
            data-testid="content-upload-status"
          >
            <strong>{uploadStatusHeadline(upload.status)}</strong>
            {upload.status === 'idle' ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={PREVIEW_EMPTY} />
            ) : (
              <span>{statusMessage}</span>
            )}
          </div>

          {upload.status === 'ready' ? (
            <div className="dash-table-wrap content-staged-preview" data-testid="content-staged-preview">
              <Table<PreviewLine>
                pagination={false}
                rowKey="key"
                dataSource={previewLines}
                columns={hasDomain ? [
                  previewColumn('域', 'domain'),
                  previewColumn('场景', 'scene'),
                  previewColumn('标准话术', 'script'),
                ] : [
                  previewColumn('场景', 'scene'),
                  previewColumn('标准话术', 'script'),
                ]}
              />
            </div>
          ) : null}

          <p data-testid="content-upload-draft-copy" className="content-upload-draft">
            {UPLOAD_COPY.draftOnlyCopy}
          </p>
        </div>
      </section>
    </div>
  );
}
