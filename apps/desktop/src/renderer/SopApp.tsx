import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { COPY_SUCCESS_MESSAGE } from '@shared/contracts';
import { useWindowDrag } from './lib/use-window-drag';
import {
  SOP_END_FLOW_LABEL,
  SOP_INTERNAL_NOTE_PREFIX,
  SOP_OPENING_MESSAGE,
  SOP_TERMINAL_MESSAGE,
  SOP_UNPUBLISHED_MESSAGE,
  type SopProjectedScript,
  type SopProjection,
} from '@shared/sop-window';
import {
  isSopPipelineProjection,
  type SopPipelineProjection,
} from '@shared/sop-pipeline';
import './styles/sop.css';

type SopAppProps = {
  projection?: SopProjection | SopPipelineProjection;
};

const RISK_COPY = {
  low: { label: '低风险', className: 'risk-chip' },
  medium: { label: '需人工核对', className: 'risk-chip is-medium' },
  high: { label: '高风险 · 需复核', className: 'risk-chip is-high' },
} as const;

function sopLayoutSignature(projection: SopProjection): string {
  return [
    projection.sessionId,
    projection.stepIndex,
    projection.shellState,
    projection.nodeKind,
    projection.script?.scriptId ?? '',
    projection.edges.map((edge) => edge.id).join(','),
    projection.canNext ? '1' : '0',
    projection.terminal ? '1' : '0',
    projection.internalNote ? '1' : '0',
    projection.internalTask ? '1' : '0',
    projection.failCode ?? '',
    projection.copied ? '1' : '0',
    projection.prompt,
  ].join('|');
}

function pipelineLayoutSignature(projection: SopPipelineProjection): string {
  return [
    projection.projectionVersion,
    projection.sessionId,
    projection.state,
    projection.currentStepId,
    projection.stepKind,
    projection.stepText,
    projection.media.map((media) => media.mediaId).join(','),
    projection.branches.map((branch) => branch.branchId).join(','),
    projection.canNext ? '1' : '0',
    projection.terminal ? '1' : '0',
    projection.copied ? '1' : '0',
    projection.failCode ?? '',
  ].join('|');
}

function pipelineFailureCopy(projection: SopPipelineProjection): string {
  if (projection.failCode === 'SOP_MEDIA_MISSING') return '本步图片没有加载，不能只复制文字。';
  if (projection.failCode === 'SOP_SESSION_CHANGED') return '登录状态已经变化，请重新查询。';
  if (projection.failCode === 'SOP_RELEASE_CHANGED') return '流程版本已经变化，请重新查询。';
  if (projection.failCode === 'SOP_REVOKED') return '当前流程权限已经撤销。';
  if (projection.failCode === 'SOP_EXPIRED') return '当前流程使用期限已经结束。';
  return '';
}

function SopPipelineView({
  projection,
  copying,
  drag,
  shellRef,
  onCopy,
  onChooseBranch,
  onNext,
  onEnd,
}: {
  projection: SopPipelineProjection;
  copying: boolean;
  drag: ReturnType<typeof useWindowDrag>;
  shellRef: RefObject<HTMLDivElement>;
  onCopy: () => void;
  onChooseBranch: (branchId: string) => void;
  onNext: () => void;
  onEnd: () => void;
}) {
  const failed = projection.state !== 'ready';
  const copyable = !failed && projection.stepKind !== 'decision' && projection.stepKind !== 'opening'
    && projection.stepText.length > 0;
  return (
    <div
      className="sop-shell query-shell"
      data-testid="sop-pipeline-shell"
      data-window-role="sop"
      ref={shellRef}
    >
      <div className="glass-shell">
        <div className="glass-surface" aria-hidden="true" />
        <header className="sop-chrome" data-testid="sop-chrome" {...drag}>
          <div className="sop-chrome-title">
            <strong>{projection.title}</strong>
            <span data-testid="sop-pipeline-sop">{projection.sopId}</span>
          </div>
          <div className="sop-chrome-tools">
            <button
              type="button"
              className="sop-close"
              data-testid="sop-close"
              aria-label="收起流程，保留进度"
              title="收起，保留进度"
              onClick={() => {
                void window.sopWindow?.close();
              }}
            >
              ×
            </button>
          </div>
        </header>
        <div className="sop-body" data-testid="sop-pipeline-body">
          {failed ? (
            <p className="status-banner is-error" data-testid="sop-pipeline-failure">
              {pipelineFailureCopy(projection)}
            </p>
          ) : null}
          {projection.stepText ? (
            <p className="sop-prompt" data-testid="sop-pipeline-step-text">
              {projection.stepText}
            </p>
          ) : null}
          {projection.media.length > 0 ? (
            <p className="sop-todo" data-testid="sop-pipeline-media">
              本步绑定 {projection.media.length} 张图片，复制时与文字一起写入。
            </p>
          ) : null}
          {copyable ? (
            <button
              type="button"
              className={projection.copied ? 'copy-btn is-copied' : 'copy-btn'}
              data-testid="sop-pipeline-copy"
              disabled={copying}
              onClick={onCopy}
            >
              {projection.copied ? COPY_SUCCESS_MESSAGE : '复制本步'}
            </button>
          ) : null}
          {projection.branches.length > 0 ? (
            <div className="sop-branches" data-testid="sop-pipeline-branches">
              {projection.branches.map((branch) => (
                <button
                  key={branch.branchId}
                  type="button"
                  className="retry-btn"
                  data-testid={`sop-pipeline-branch-${branch.branchId}`}
                  onClick={() => onChooseBranch(branch.branchId)}
                >
                  {branch.label}
                </button>
              ))}
            </div>
          ) : null}
          {projection.canNext ? (
            <button
              type="button"
              className="retry-btn"
              data-testid="sop-pipeline-next"
              onClick={onNext}
            >
              下一步
            </button>
          ) : null}
          {projection.terminal ? (
            <p className="sop-terminal" data-testid="sop-terminal">{SOP_TERMINAL_MESSAGE}</p>
          ) : null}
          <button
            type="button"
            className="sop-end"
            data-testid="sop-pipeline-end"
            data-sop-end="true"
            onClick={onEnd}
          >
            {SOP_END_FLOW_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

function SopCopyCard({
  script,
  copying,
  copied,
  onCopy,
}: {
  script: SopProjectedScript;
  copying: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const risk = RISK_COPY[script.riskLevel];
  return (
    <article
      className={['script-card', script.riskLevel === 'high' ? 'is-high' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="script-card-1"
    >
      <div className="card-top">
        <div className="card-kicker">
          <span className="scene-label">{script.scopeLabel}</span>
        </div>
        <div className="card-top-tags">
          <span className={risk.className} data-testid="risk-1">{risk.label}</span>
        </div>
      </div>
      <div className="card-answer-row">
        <p className="answer-text" data-testid="answer-text-1">{script.answerText}</p>
        <button
          type="button"
          className={copied ? 'copy-btn is-copied' : 'copy-btn'}
          data-testid="copy-button-1"
          disabled={copying}
          aria-keyshortcuts="1"
          onClick={onCopy}
        >
          {copied ? COPY_SUCCESS_MESSAGE : '复制话术'}
        </button>
      </div>
      <div className="meta-row">
        <span className="meta-chip">{script.platform}</span>
      </div>
    </article>
  );
}

export function SopApp({ projection: injected }: SopAppProps) {
  const [projection, setProjection] = useState<SopProjection | SopPipelineProjection | null>(injected ?? null);
  const [copying, setCopying] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const layoutSequenceRef = useRef(0);
  const sessionHintRef = useRef(0);

  useEffect(() => {
    if (injected) {
      setProjection(injected);
      return undefined;
    }
    return window.sopWindow?.onProjection((next) => {
      setProjection(next);
    });
  }, [injected]);

  const layoutSignature = projection
    ? isSopPipelineProjection(projection)
      ? pipelineLayoutSignature(projection)
      : sopLayoutSignature(projection)
    : '';

  const reportLayout = useCallback((desiredHeight: number) => {
    const api = window.sopWindow?.reportLayout;
    if (!api || injected) {
      return;
    }
    const request = {
      sessionId: Math.max(1, projection?.sessionId ?? sessionHintRef.current ?? 1),
      sequence: ++layoutSequenceRef.current,
      desiredHeight,
    };
    void api(request).then((ack) => {
      if (ack.ok) {
        sessionHintRef.current = ack.sessionId;
      }
    }).catch(() => undefined);
  }, [injected, projection?.sessionId]);

  useLayoutEffect(() => {
    if (injected || !layoutSignature) {
      return undefined;
    }
    const shell = shellRef.current;
    if (!shell) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const last = shell.querySelector<HTMLElement>('[data-sop-end]');
      const desired = last
        ? Math.ceil(last.getBoundingClientRect().bottom - shell.getBoundingClientRect().top + 12)
        : shell.scrollHeight;
      reportLayout(desired);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [injected, layoutSignature, reportLayout]);

  const drag = useWindowDrag(
    (dx, dy, finished) => {
      void window.sopWindow?.moveBy(dx, dy, finished);
    },
    () => undefined,
  );

  const copyCurrent = useCallback(async () => {
    if (copying || projection?.copied) {
      return;
    }
    setCopying(true);
    try {
      await window.sopWindow?.copyCurrent();
    } finally {
      setCopying(false);
    }
  }, [copying, projection?.copied]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void window.sopWindow?.close();
        return;
      }
      if (
        event.key === '1'
        && projection
        && (isSopPipelineProjection(projection)
          ? projection.state === 'ready' && projection.stepText.length > 0 && projection.stepKind !== 'decision'
          : Boolean(projection.script))
        && !event.repeat
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault();
        void copyCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyCurrent, projection]);

  if (!projection) {
    return null;
  }

  if (isSopPipelineProjection(projection)) {
    return (
      <SopPipelineView
        projection={projection}
        copying={copying || projection.copied}
        drag={drag}
        shellRef={shellRef}
        onCopy={() => {
          void copyCurrent();
        }}
        onChooseBranch={(branchId) => {
          void window.sopWindow?.chooseEdge(branchId);
        }}
        onNext={() => {
          void window.sopWindow?.nextStep();
        }}
        onEnd={() => {
          void window.sopWindow?.endFlow();
        }}
      />
    );
  }

  const opening = projection.shellState === 'opening';
  const failed = projection.shellState === 'failed';

  return (
    <div className="sop-shell query-shell" data-testid="sop-shell" data-window-role="sop" ref={shellRef}>
      <div className="glass-shell">
        <div className="glass-surface" aria-hidden="true" />
        <header className="sop-chrome" data-testid="sop-chrome" {...drag}>
          <div className="sop-chrome-title">
            <strong>{projection.sceneTitle}</strong>
            <span data-testid="sop-step">步骤 {projection.stepIndex}</span>
          </div>
          <div className="sop-chrome-tools">
            {projection.demo ? <span className="env-badge">DEMO</span> : null}
            <button
              type="button"
              className="sop-close"
              data-testid="sop-close"
              aria-label="收起过敏流程，保留进度"
              title="收起，保留进度"
              onClick={() => {
                void window.sopWindow?.close();
              }}
            >
              ×
            </button>
          </div>
        </header>
        <div className="sop-body" data-testid="sop-body">
          {opening ? (
            <div className="sop-opening" data-testid="sop-opening">
              <p>{SOP_OPENING_MESSAGE}</p>
            </div>
          ) : null}
          {failed ? (
            <div className="sop-failed" data-testid="sop-failed">
              <p className="status-banner is-error">{projection.failMessage || '过敏流程没打开'}</p>
              <button
                type="button"
                className="retry-btn"
                data-testid="sop-retry"
                onClick={() => {
                  void window.sopWindow?.restart();
                }}
              >
                重试
              </button>
            </div>
          ) : null}
          {!opening && !failed ? (
            <>
              {projection.highRiskBanner ? (
                <div className="status-banner" data-testid="sop-high-risk">
                  {projection.highRiskBanner}
                </div>
              ) : null}
              {projection.prompt ? (
                <p className="sop-prompt" data-testid="sop-prompt">{projection.prompt}</p>
              ) : null}
              {projection.internalNote ? (
                <div className="sop-internal-banner" data-testid="sop-internal-note">
                  <strong>{SOP_INTERNAL_NOTE_PREFIX}</strong>
                  <span>{projection.internalNote}</span>
                </div>
              ) : null}
              {projection.script ? (
                <SopCopyCard
                  script={projection.script}
                  copying={copying || projection.copied}
                  copied={projection.copied}
                  onCopy={() => {
                    void copyCurrent();
                  }}
                />
              ) : null}
              {projection.unpublished ? (
                <p className="sop-todo" data-testid="sop-unpublished">{SOP_UNPUBLISHED_MESSAGE}</p>
              ) : null}
              {projection.canNext ? (
                <button
                  type="button"
                  className="retry-btn"
                  data-testid="sop-next"
                  onClick={() => {
                    void window.sopWindow?.nextStep();
                  }}
                >
                  下一步
                </button>
              ) : null}
              {projection.edges.length > 0 ? (
                <div className="sop-branches" data-testid="sop-branches">
                  {projection.edges.map((edge) => (
                    <button
                      key={edge.id}
                      type="button"
                      className="retry-btn"
                      data-testid={`sop-edge-${edge.id}`}
                      onClick={() => {
                        void window.sopWindow?.chooseEdge(edge.id);
                      }}
                    >
                      {edge.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {projection.internalTask ? (
                <p className="sop-todo" data-testid="sop-internal-task">{projection.internalTask}</p>
              ) : null}
              {projection.terminal ? (
                <p className="sop-terminal" data-testid="sop-terminal">{SOP_TERMINAL_MESSAGE}</p>
              ) : null}
              <button
                type="button"
                className="sop-end"
                data-testid="sop-end-flow"
                data-sop-end="true"
                onClick={() => {
                  void window.sopWindow?.endFlow();
                }}
              >
                {SOP_END_FLOW_LABEL}
              </button>
            </>
          ) : (
            <span data-sop-end="true" hidden />
          )}
        </div>
      </div>
    </div>
  );
}
