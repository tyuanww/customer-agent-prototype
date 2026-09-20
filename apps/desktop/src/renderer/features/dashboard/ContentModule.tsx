import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { DASHBOARD_MANIFEST, type DomainId } from '../../data/dashboard-manifest';
import {
  bindingsForRows,
  contentPublishGate,
  CONTENT_PUBLISH_COPY,
  type DashboardContentSessionView,
} from '@shared/dashboard-content';
import {
  parseCoachUploadCsv,
  readCoachUploadFile,
  type CoachUploadResult,
  type CoachUploadRow,
} from './coach-content-upload';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.content;

type UploadView =
  | { status: 'idle' }
  | { status: 'reading'; sourceName: string }
  | { status: 'ready'; sourceName: string; rows: readonly CoachUploadRow[]; csvText: string }
  | { status: 'reviewed'; sourceName: string; rows: readonly CoachUploadRow[]; csvText: string; reviewedAt: string; reviewerRole: string }
  | { status: 'error'; message: string };

type PipelineStepStatus = 'pending' | 'active' | 'done';

function pipelineStepStatus(
  step: 'import' | 'review' | 'publish',
  upload: UploadView,
  submitting: boolean,
): PipelineStepStatus {
  if (step === 'import') {
    if (upload.status === 'idle' || upload.status === 'error') return 'active';
    if (upload.status === 'reading') return 'active';
    return 'done';
  }
  if (step === 'review') {
    if (upload.status === 'idle' || upload.status === 'reading' || upload.status === 'error') return 'pending';
    if (upload.status === 'ready') return 'active';
    return 'done';
  }
  // publish
  if (upload.status === 'reviewed') return submitting ? 'active' : 'active';
  return 'pending';
}

function pipelineItemClass(step: string, upload: UploadView, submitting: boolean): string {
  if (submitting && step === 'Publish') return 'is-current';
  if (upload.status === 'reading' && step === 'Import') return 'is-current';
  if (upload.status !== 'ready' && upload.status !== 'reviewed') return '';
  if (step === 'Import' || step === 'Validate') return 'is-done';
  if (step === 'Staged') return upload.status === 'reviewed' ? 'is-done' : 'is-current';
  return '';
}

function domainLabel(domain: DomainId | undefined): string {
  if (!domain) return '未标注';
  return data.domains.find((item) => item.id === domain)?.label ?? domain;
}

function applyUploadResult(result: CoachUploadResult): UploadView {
  if (result.ok) {
    return { status: 'ready', sourceName: result.sourceName, rows: result.rows, csvText: result.csvText };
  }
  return { status: 'error', message: result.message };
}

function uploadRows(upload: UploadView): readonly CoachUploadRow[] {
  if (upload.status === 'ready' || upload.status === 'reviewed') return upload.rows;
  return [];
}

function uploadCsvText(upload: UploadView): string {
  if (upload.status === 'ready' || upload.status === 'reviewed') return upload.csvText;
  return '';
}

function uploadSourceName(upload: UploadView): string {
  if (upload.status === 'ready' || upload.status === 'reviewed') return upload.sourceName;
  return '';
}

export function ContentModule() {
  const [selectedId, setSelectedId] = useState(data.releases[0]?.releaseId ?? '');
  const [upload, setUpload] = useState<UploadView>({ status: 'idle' });
  const [sessionView, setSessionView] = useState<DashboardContentSessionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const ingestGeneration = useRef(0);
  const selected = data.releases.find((release) => release.releaseId === selectedId) ?? data.releases[0];
  const hasDomain = (upload.status === 'ready' || upload.status === 'reviewed')
    && upload.rows.some((row) => row.domain);
  const statusMessage = upload.status === 'reviewed'
    ? `审核通过 · ${upload.rows.length} 行 · ${upload.sourceName} · 可发布`
    : upload.status === 'ready'
      ? `已进入待审核草稿 · ${upload.rows.length} 行 · ${upload.sourceName} · 不是已发布`
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
  // Owner must go through the review gate before publishing; coach can publish directly
  // if contentPublishGate allows it (product/campaign content only).
  const ownerNeedsReview = sessionView?.role === 'owner' && upload.status !== 'reviewed';
  const publishDisabled = ownerNeedsReview || !gate.allowed || submitting;
  const gateBlocksHard = !gate.allowed && gate.code !== 'VALIDATION';
  const publishReason = submitting
    ? CONTENT_PUBLISH_COPY.submitting
    : gateBlocksHard
      ? gate.message
      : upload.status === 'idle' || upload.status === 'error'
        ? '请先导入草稿'
        : upload.status === 'reading'
          ? '正在读取文件'
          : ownerNeedsReview
            ? '请先完成审核确认'
            : gate.allowed
              ? ''
              : gate.message;

  const loadDemo = () => {
    ingestGeneration.current += 1;
    setPublishFeedback(null);
    setUpload(applyUploadResult(parseCoachUploadCsv(data.upload.demoCsv, data.upload.demoFileName)));
  };

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

  const onReviewConfirm = () => {
    if (upload.status !== 'ready' || sessionView?.role !== 'owner') return;
    setUpload({
      status: 'reviewed',
      sourceName: upload.sourceName,
      rows: upload.rows,
      csvText: upload.csvText,
      reviewedAt: new Date().toLocaleString('zh-CN'),
      reviewerRole: 'owner',
    });
  };

  const onPublish = () => {
    if (publishDisabled || (upload.status !== 'ready' && upload.status !== 'reviewed') || submitting) return;
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
      setPublishFeedback(`已提交发布 · ${result.releaseId}`);
    }).finally(() => {
      if (generation === ingestGeneration.current) setSubmitting(false);
    });
  };

  const unreviewedDomainCount = upload.status === 'ready'
    ? new Set(upload.rows.map((r) => r.domain).filter(Boolean)).size
    : 0;
  const hasUntaggedRows = upload.status === 'ready' && upload.rows.some((r) => !r.domain);

  return (
    <div className="dash-module" data-testid="module-content">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
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
          <span data-testid="publish-disabled-reason">{publishReason}</span>
          {publishFeedback ? <span data-testid="publish-feedback">{publishFeedback}</span> : null}
        </div>
      </header>

      <ol className="content-pipeline-steps" aria-label="发布流程" data-testid="content-pipeline-steps">
        <li data-step-status={pipelineStepStatus('import', upload, submitting)}>
          <span aria-hidden="true">1</span>导入草稿
        </li>
        <li data-step-status={pipelineStepStatus('review', upload, submitting)}>
          <span aria-hidden="true">2</span>审核确认
        </li>
        <li data-step-status={pipelineStepStatus('publish', upload, submitting)}>
          <span aria-hidden="true">3</span>发布
        </li>
      </ol>

      <ol className="dash-pipeline" data-testid="content-pipeline">
        {data.pipeline.map((step, index) => (
          <li key={step} className={pipelineItemClass(step, upload, submitting)} data-pipeline-step={step}>
            <span>{index + 1}</span>{step}
          </li>
        ))}
      </ol>

      <p className="dash-scope dash-scope-important" data-testid="formal-source-warning">
        正式来源现状：产品、活动已有受控材料，但四域整体签发尚未完成。售前仍为
        NOT_CREATED / UPSTREAM_AUTHORING。售后仅合成过敏树样例（DEMO），非正式签发，不接本页上传。
        下列 release 仅演示“缺域即阻断”的产品合同，不代表正式四域已齐。
      </p>

      <section className="dash-card content-upload" data-testid="content-upload-panel" aria-labelledby="content-upload-title">
        <div className="content-upload-copy">
          <span className="dash-card-label">{data.upload.title}</span>
          <h2 id="content-upload-title">本地导入进入待审核草稿</h2>
          <p data-testid="content-upload-draft-copy">{data.upload.draftOnlyCopy}</p>
          <p data-testid="content-upload-role-note">{data.upload.roleNote}</p>
          <p data-testid="content-upload-boundary">{data.upload.boundaryCopy}</p>
          <p data-testid="content-aftersale-note">{data.upload.aftersaleNote}</p>
        </div>

        <div className="dash-filter-toolbar compact content-upload-controls" aria-label="话术师上传">
          <label className="is-grow" htmlFor="content-upload-file">
            <span>选择 CSV 或 xlsx</span>
            <input
              id="content-upload-file"
              type="file"
              accept={data.upload.accept}
              data-testid="content-upload-input"
              disabled={upload.status === 'reading' || submitting}
              onChange={onFileChange}
            />
          </label>
          <button
            type="button"
            className="dash-action-primary"
            data-testid="content-upload-demo"
            disabled={upload.status === 'reading' || submitting}
            onClick={loadDemo}
          >
            载入合成样例
          </button>
          <button
            type="button"
            className="dash-reset"
            data-testid="content-upload-clear"
            disabled={upload.status === 'idle' || upload.status === 'reading' || upload.status === 'reviewed' || submitting}
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
            upload.status === 'reviewed'
              ? '审核通过 · 待发布'
              : upload.status === 'ready'
                ? '待审核草稿'
                : upload.status === 'reading'
                  ? '正在读取'
                  : upload.status === 'error'
                    ? '未进入草稿'
                    : '等待导入'
          }</strong>
          <span>{statusMessage}</span>
        </div>

        {upload.status === 'ready' && sessionView?.role === 'owner' ? (
          <section
            className="content-review-gate"
            aria-labelledby="content-review-gate-title"
            data-testid="content-review-gate"
          >
            <h3 id="content-review-gate-title">审核确认</h3>
            <dl className="dash-dl">
              <div>
                <dt>导入行数</dt>
                <dd data-testid="review-row-count">{upload.rows.length} 行</dd>
              </div>
              <div>
                <dt>已标注域</dt>
                <dd data-testid="review-domain-count">{unreviewedDomainCount} 个</dd>
              </div>
              <div>
                <dt>未标注行</dt>
                <dd data-testid="review-untagged">
                  {hasUntaggedRows
                    ? <span className="is-risk">有未标注行，发布前请确认域归属</span>
                    : '无'}
                </dd>
              </div>
              <div>
                <dt>来源文件</dt>
                <dd>{upload.sourceName}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="content-review-confirm dash-action-primary"
              data-testid="content-review-confirm"
              onClick={onReviewConfirm}
            >
              确认审核通过，进入发布
            </button>
          </section>
        ) : null}

        {upload.status === 'reviewed' ? (
          <div className="content-review-result" data-testid="content-review-result" aria-live="polite">
            <StatusBadge label="审核通过" tone="ok" />
            <span>审核人：{upload.reviewerRole} · {upload.reviewedAt}</span>
          </div>
        ) : null}

        {(upload.status === 'ready' || upload.status === 'reviewed') ? (
          <div className="dash-table-wrap content-staged-preview" data-testid="content-staged-preview">
            <table className="dash-table">
              <caption>草稿预览 · 场景 / 标准话术</caption>
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

      <div className="dash-release-grid" aria-label="选择合成发布结构">
        {data.releases.map((release) => (
          <button
            key={release.releaseId}
            type="button"
            className={`dash-card dash-release-card${release.blocked ? ' is-blocked' : ''}${selected.releaseId === release.releaseId ? ' is-selected' : ''}`}
            aria-pressed={selected.releaseId === release.releaseId}
            data-testid={`release-${release.releaseId}`}
            onClick={() => setSelectedId(release.releaseId)}
          >
            <span className="dash-card-row">
              <strong>{release.title}</strong>
              <StatusBadge label={release.blocked ? '阻断' : '结构演示'} tone={release.blocked ? 'danger' : 'mock'} />
            </span>
            <span className="dash-mini">{release.releaseId}</span>
            <span className="dash-domain-summary">
              {release.bindings.map((binding) => (
                <span key={binding.domain} className={binding.bound ? 'is-bound' : 'is-missing'}>
                  {binding.label} · {binding.bound ? '已绑定样例' : '缺域'}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <section className="dash-card dash-release-detail" aria-live="polite" data-testid="release-detail">
        <div className="dash-card-row">
          <div><span className="dash-card-label">所选合成发布门禁</span><h2>{selected.title}</h2></div>
          <StatusBadge label={selected.blocked ? '不可继续' : '只读结构演练'} tone={selected.blocked ? 'danger' : 'mock'} />
        </div>
        <div className="release-gate-grid">
          {selected.bindings.map((binding) => (
            <article key={binding.domain} className={binding.bound ? 'is-bound' : 'is-missing'}>
              <span>{binding.label}</span>
              <strong>{binding.bound ? '已绑定合成样例' : '缺域阻断'}</strong>
              <small>{binding.sourceId}</small>
            </article>
          ))}
        </div>
        <dl className="dash-dl dash-dl-grid">
          <div><dt>审核</dt><dd>{selected.review}</dd></div>
          <div><dt>质量</dt><dd>{selected.quality}</dd></div>
          <div><dt>有效期</dt><dd>{selected.validity}</dd></div>
          <div><dt>风险</dt><dd>{selected.risk}</dd></div>
        </dl>
        {selected.blockReason ? <p className="dash-block" data-testid="missing-domain-block">{selected.blockReason}</p> : null}
        <p className="dash-footnote">选择只改变本地展示。正式导入与发布走产品会话，不连接飞书或 Wiki。</p>
      </section>
    </div>
  );
}
