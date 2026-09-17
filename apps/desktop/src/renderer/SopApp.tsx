import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COPY_SUCCESS_MESSAGE } from '@shared/contracts';
import { useWindowDrag } from './lib/use-window-drag';
import {
  SOP_END_FLOW_LABEL,
  SOP_HIGH_RISK_BANNER,
  SOP_INTERNAL_NOTE_PREFIX,
  SOP_OPENING_MESSAGE,
  SOP_TERMINAL_MESSAGE,
  SOP_UNPUBLISHED_MESSAGE,
  type SopProjectedScript,
  type SopProjection,
} from '@shared/sop-window';
import './styles/sop.css';

type SopAppProps = {
  projection?: SopProjection;
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
  ].join('|');
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
      className={['script-card', 'is-lead', script.riskLevel === 'high' ? 'is-high' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="script-card-1"
    >
      <div className="card-top">
        <div className="card-kicker">
          <kbd className="rank" aria-label="按数字 1 快速复制">1</kbd>
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
        <span className={`match-chip is-${script.matchKind}`} data-testid="match-reason-1">
          {script.matchLabel}
        </span>
        <span className="meta-chip">{script.domain}</span>
        <span className="meta-chip">{script.platform}</span>
      </div>
    </article>
  );
}

export function SopApp({ projection: injected }: SopAppProps) {
  const [projection, setProjection] = useState<SopProjection | null>(injected ?? null);
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

  const layoutSignature = projection ? sopLayoutSignature(projection) : '';

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
        && projection?.script
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
  }, [copyCurrent, projection?.script]);

  if (!projection) {
    return null;
  }

  const opening = projection.shellState === 'opening';
  const failed = projection.shellState === 'failed';

  return (
    <div className="sop-shell query-shell" data-testid="sop-shell" data-window-role="sop" ref={shellRef}>
      <div className="glass-shell">
        <div className="glass-surface" aria-hidden="true" />
        <header className="sop-chrome" data-testid="sop-chrome" {...drag}>
          <div className="sop-chrome-title">
            <strong>{projection.sceneTitle} · {projection.stageLabel}</strong>
            <span data-testid="sop-step">步骤 {projection.stepIndex}</span>
          </div>
          <div className="sop-chrome-tools">
            {projection.demo ? <span className="env-badge">DEMO</span> : null}
            <button
              type="button"
              className="sop-close"
              data-testid="sop-close"
              aria-label="关闭过敏流程"
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
              <div className="status-banner is-error" data-testid="sop-high-risk">
                {SOP_HIGH_RISK_BANNER}
              </div>
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
