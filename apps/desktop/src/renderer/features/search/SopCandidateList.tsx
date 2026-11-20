import { useLayoutEffect, useRef, useState } from 'react';
import type { IntakeSopCandidate } from '@shared/content-intake-query';

type CandidateState = { kind: 'idle' | 'opening' } | { kind: 'opened' | 'unavailable' | 'retry'; message: string };
const retry = { kind: 'retry', message: '流程没有打开。请再次点击流程名称重试。' } satisfies CandidateState;

function SopCandidateButton({ candidate, onFeedbackLayoutChange }: {
  candidate: IntakeSopCandidate;
  onFeedbackLayoutChange?: () => void;
}) {
  const [state, setState] = useState<CandidateState>({ kind: 'idle' });
  const feedback = 'message' in state ? state.message : undefined;
  const previousFeedback = useRef(feedback);
  useLayoutEffect(() => {
    if (previousFeedback.current !== feedback) {
      previousFeedback.current = feedback;
      onFeedbackLayoutChange?.();
    }
  }, [feedback, onFeedbackLayoutChange]);
  const open = async () => {
    setState({ kind: 'opening' });
    try {
      const result = await window.customerAgent?.intakeQuery?.openSopCandidate?.({ key: candidate.key });
      if (result?.ok) setState({ kind: 'opened', message: '流程窗口已打开。' });
      else if (result?.code === 'SOP_CANDIDATE_UNAVAILABLE' || result?.code === 'STALE') {
        setState({ kind: 'unavailable', message: result.message });
      } else setState(retry);
    } catch {
      setState(retry);
    }
  };
  return <div>
    <button type="button" className="retry-btn" disabled={state.kind !== 'idle' && state.kind !== 'retry'}
      aria-busy={state.kind === 'opening'} onClick={() => { void open(); }}>{candidate.label}</button>
    {feedback ? <p role="status">{feedback}</p> : null}
  </div>;
}

const statusText = {
  searching: '正在查找 SOP 候选…',
  unavailable: 'SOP 候选暂不可用，请重新查询。',
  stale: 'SOP 候选已失效，请重新查询。',
};

export function SopCandidateList({ candidates, onFeedbackLayoutChange }: {
  candidates: IntakeSopCandidate[];
  onFeedbackLayoutChange: () => void;
}) {
  const buttons = candidates.map(candidate => <SopCandidateButton key={candidate.key} candidate={candidate}
    onFeedbackLayoutChange={onFeedbackLayoutChange} />);

  return candidates.length <= 2
    ? <div className="sop-candidate-shortlist" data-testid="sop-candidates">{buttons}</div>
    : <details className="sop-candidate-menu" onToggle={onFeedbackLayoutChange}>
      <summary className="intake-filter-toggle">选择办理流程（{candidates.length}）</summary>
      <div className="sop-candidate-options" data-testid="sop-candidates">{buttons}</div>
    </details>;
}

export function SopCandidateStatus({ status }: { status: keyof typeof statusText }) {
  return <p role="status">{statusText[status]}</p>;
}
