import { useState } from 'react';
import type { IntakeSopCandidate, IntakeSopCandidatesEvent } from '@shared/content-intake-query';

type CandidateState = { kind: 'idle' | 'opening' } | { kind: 'opened' | 'unavailable' | 'retry'; message: string };
const retry = { kind: 'retry', message: '流程没有打开。请再次点击流程名称重试。' } satisfies CandidateState;

function SopCandidateButton({ candidate }: { candidate: IntakeSopCandidate }) {
  const [state, setState] = useState<CandidateState>({ kind: 'idle' });
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
    {'message' in state ? <p role="status">{state.message}</p> : null}
  </div>;
}

const statusText = {
  searching: '正在查找 SOP 候选…',
  unavailable: 'SOP 候选暂不可用，请重新查询。',
  stale: 'SOP 候选已失效，请重新查询。',
};

export function SopCandidateList({ event }: { event: IntakeSopCandidatesEvent }) {
  if ('status' in event) {
    return <p className="sop-entry-banner" role="status" data-sop-candidates>
      {statusText[event.status]}
    </p>;
  }
  if (!event.candidates.length) return null;
  return <section className="sop-entry-banner sop-candidate-list" aria-label="SOP 候选" data-testid="sop-candidates" data-sop-candidates>
    <strong>SOP 候选</strong>
    {event.candidates.map(candidate => <SopCandidateButton key={candidate.key} candidate={candidate} />)}
  </section>;
}
