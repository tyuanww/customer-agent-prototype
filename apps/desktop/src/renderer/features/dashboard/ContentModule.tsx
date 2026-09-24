import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { type DomainId } from '../../data/dashboard-manifest';
import {
  bindingsForRows,
  contentPublishGate,
  CONTENT_PUBLISH_COPY,
  type DashboardContentSessionView,
} from '@shared/dashboard-content';
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
} as const;

type UploadView =
  | { status: 'idle' }
  | { status: 'reading'; sourceName: string }
  | { status: 'ready'; sourceName: string; rows: readonly CoachUploadRow[]; csvText: string }
  | { status: 'error'; message: string };

type PipelineStepStatus = 'pending' | 'active' | 'done';

function pipelineStepStatus(
  step: 'import' | 'publish',
  upload: UploadView,
  submitting: boolean,
): PipelineStepStatus {
  if (step === 'import') {
    if (upload.status === 'idle' || upload.status === 'error' || upload.status === 'reading') return 'active';
    return 'done';
  }
  if (upload.status === 'ready') return 'active';
  return 'pending';
}

function domainLabel(domain: DomainId | undefined): string {
  if (!domain) return '未标注';
  return DOMAIN_LABELS[domain];
}

function applyUploadResult(result: CoachUploadResult): UploadView {
  if (result.ok) {
    return { status: 'ready', sourceName: result.sourceName, rows: result.rows, csvText: result.csvText };
  }
  return { status: 'error', message: result.message };
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

export function ContentModule() {
  const [upload, setUpload] = useState<UploadView>({ status: 'idle' });
  const [sessionView, setSessionView] = useState<DashboardContentSessionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const ingestGeneration = useRef(0);
  const hasDomain = upload.status === 'ready' && upload.rows.some((row) => row.domain);
  const statusMessage = upload.status === 'ready'
    ? `待发布 · ${upload.rows.length} 行 · ${upload.sourceName} · 不是已发布`
    : upload.status === 'reading'
      ? `正在读取 ${upload.sourceName} · 只在本页预览，不会发布`
      : upload.status === 'error'
        ? upload.message
        : '尚未导入。选择 CSV 或 xlsx；中文表头（快捷短语/产品话术）会映射到场景与标准话术。空白行会跳过。';

  useEffect(() => {
    const api = window.dashboardContent;
    if (!api) return undefined;
    let live = true;
    const load = () => {
      void api.session().then((result) => {
        if (!live) return;
        setSessionView(result.ok ? result : null);
      }).catch(() => {
        if (!live) return;
        setSessionView(null);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  const rows = uploadRows(upload);
  const sourceBindings = bindingsForRows(rows);
  const gate = contentPublishGate({
    productAvailable: Boolean(window.dashboardContent) && sessionView?.enabled !== false,
    signedIn: sessionView?.signedIn === true,
    role: sessionView?.role ?? null,
    rows,
    sourceBindings,
  });
  const publishDisabled = !gate.allowed || submitting || upload.status !== 'ready';
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

  const clearUpload = () => {
    ingestGeneration.current += 1;
    setPublishFeedback(null);
    setUpload({ status: 'idle' });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const generation = ingestGeneration.current + 1;
    ingestGeneration.current = generation;
    setPublishFeedback(null);
    setUpload({ status: 'reading', sourceName: file.name.trim() || 'untitled.csv' });
    void readCoachUploadFile(file).then(
      (result) => {
        if (generation !== ingestGeneration.current) return;
        setUpload(applyUploadResult(result));
      },
      () => {
        if (generation !== ingestGeneration.current) return;
        setUpload({
          status: 'error',
          message: '本地读取失败。未连接飞书或 Wiki，也没有进入已发布状态。',
        });
      },
    );
  };

  const onCancelInFlight = () => {
    const api = window.dashboardContent;
    if (!api?.cancelInFlight) return;
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
      const who = result.publisherDisplayName ?? sessionView?.displayName;
      setPublishFeedback(who
        ? `已发布 ${result.releaseId} · ${who}`
        : `已发布 ${result.releaseId}`);
    }).catch(() => {
      if (generation !== ingestGeneration.current) return;
      setPublishFeedback('未接入');
    }).finally(() => {
      if (generation === ingestGeneration.current) setSubmitting(false);
    });
  };

  return (
    <div className="dash-module" data-testid="module-content">
      <header className="dash-module-head">
        <div>
          <h1>内容管理</h1>
          <p className="dash-kicker">导入 · 发布</p>
        </div>
        <div className="dash-publish-box">
          <button
            type="button"
            className="dash-publish"
            disabled={publishDisabled}
            data-testid="publish-action"
            onClick={onPublish}
          >
            发布
          </button>
          <button
            type="button"
            className="dash-reset"
            data-testid="cancel-in-flight"
            disabled={submitting}
            onClick={onCancelInFlight}
          >
            取消未完成导入
          </button>
          <span data-testid="publish-disabled-reason">{publishReason}</span>
          {publishFeedback ? <span data-testid="publish-feedback">{publishFeedback}</span> : null}
        </div>
      </header>

      <ol className="content-pipeline-steps" aria-label="发布流程" data-testid="content-pipeline-steps">
        <li data-step-status={pipelineStepStatus('import', upload, submitting)}>
          <span aria-hidden="true">1</span>导入
        </li>
        <li data-step-status={pipelineStepStatus('publish', upload, submitting)}>
          <span aria-hidden="true">2</span>发布
        </li>
      </ol>

      <p className="dash-scope dash-scope-important" data-testid="formal-source-warning">
        导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。
      </p>

      <section className="dash-card content-upload" data-testid="content-upload-panel" aria-labelledby="content-upload-title">
        <div className="content-upload-copy">
          <span className="dash-card-label">{UPLOAD_COPY.title}</span>
          <h2 id="content-upload-title">本地导入进入待发布</h2>
          <p data-testid="content-upload-draft-copy">{UPLOAD_COPY.draftOnlyCopy}</p>
          <p data-testid="content-upload-role-note">{UPLOAD_COPY.roleNote}</p>
          <p data-testid="content-upload-boundary">{UPLOAD_COPY.boundaryCopy}</p>
          <p data-testid="content-aftersale-note">售后 SOP 写库未接入，本页不展开合成树。</p>
        </div>

        <div className="dash-filter-toolbar compact content-upload-controls" aria-label="内容导入">
          <label className="is-grow" htmlFor="content-upload-file">
            <span>选择 CSV 或 xlsx</span>
            <input
              id="content-upload-file"
              type="file"
              accept={UPLOAD_COPY.accept}
              data-testid="content-upload-input"
              disabled={upload.status === 'reading' || submitting}
              onChange={onFileChange}
            />
          </label>
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
                {upload.rows.map((row, index) => (
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
      </section>
    </div>
  );
}
