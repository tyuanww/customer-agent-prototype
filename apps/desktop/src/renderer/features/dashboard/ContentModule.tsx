import { useRef, useState, type ChangeEvent } from 'react';
import { DASHBOARD_MANIFEST, type DomainId } from '../../data/dashboard-manifest';
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
  | { status: 'ready'; sourceName: string; rows: readonly CoachUploadRow[] }
  | { status: 'error'; message: string };

function pipelineItemClass(step: string, upload: UploadView): string {
  if (upload.status !== 'ready') return '';
  if (step === 'Import' || step === 'Validate') return 'is-done';
  if (step === 'Staged') return 'is-current';
  return '';
}

function domainLabel(domain: DomainId | undefined): string {
  if (!domain) return '未标注';
  return data.domains.find((item) => item.id === domain)?.label ?? domain;
}

function applyUploadResult(result: CoachUploadResult): UploadView {
  if (result.ok) {
    return { status: 'ready', sourceName: result.sourceName, rows: result.rows };
  }
  return { status: 'error', message: result.message };
}

export function ContentModule() {
  const [selectedId, setSelectedId] = useState(data.releases[0]?.releaseId ?? '');
  const [upload, setUpload] = useState<UploadView>({ status: 'idle' });
  const ingestGeneration = useRef(0);
  const selected = data.releases.find((release) => release.releaseId === selectedId) ?? data.releases[0];
  const hasDomain = upload.status === 'ready' && upload.rows.some((row) => row.domain);
  const statusMessage = upload.status === 'ready'
    ? `已进入待审核草稿 · ${upload.rows.length} 行 · ${upload.sourceName} · 不是已发布`
    : upload.status === 'error'
      ? upload.message
      : '尚未导入。选择 CSV / XLSX 或载入合成样例后，只在本页显示待审核草稿预览。';

  const loadDemo = () => {
    ingestGeneration.current += 1;
    setUpload(applyUploadResult(parseCoachUploadCsv(data.upload.demoCsv, data.upload.demoFileName)));
  };

  const clearUpload = () => {
    ingestGeneration.current += 1;
    setUpload({ status: 'idle' });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const generation = ingestGeneration.current + 1;
    ingestGeneration.current = generation;
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

  return (
    <div className="dash-module" data-testid="module-content">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <div className="dash-publish-box">
          <button type="button" className="dash-publish" disabled data-testid="publish-action">Publish</button>
          <span data-testid="publish-disabled-reason">{data.publishDisabledReason}</span>
        </div>
      </header>

      <ol className="dash-pipeline" data-testid="content-pipeline">
        {data.pipeline.map((step, index) => (
          <li key={step} className={pipelineItemClass(step, upload)} data-pipeline-step={step}>
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
            <span>选择 CSV / XLSX</span>
            <input
              id="content-upload-file"
              type="file"
              accept={data.upload.accept}
              data-testid="content-upload-input"
              onChange={onFileChange}
            />
          </label>
          <button
            type="button"
            className="dash-action-primary"
            data-testid="content-upload-demo"
            onClick={loadDemo}
          >
            载入合成样例
          </button>
          <button
            type="button"
            className="dash-reset"
            data-testid="content-upload-clear"
            disabled={upload.status === 'idle'}
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
          <strong>{upload.status === 'ready' ? '待审核草稿' : upload.status === 'error' ? '未进入草稿' : '等待导入'}</strong>
          <span>{statusMessage}</span>
        </div>

        {upload.status === 'ready' ? (
          <div className="dash-table-wrap content-staged-preview" data-testid="content-staged-preview">
            <table className="dash-table">
              <caption>待审核草稿预览 · 场景 / 标准话术</caption>
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
        <p className="dash-footnote">选择只改变本地展示；发布、回滚、审核、绑定均不可操作，也不会写入任何系统。</p>
      </section>
    </div>
  );
}
