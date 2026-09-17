import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SopApp } from '../../src/renderer/SopApp';
import {
  chooseSopEdge,
  projectSop,
  startSopProgress,
} from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import { SOP_COPY_FEEDBACK_MS } from '../../src/shared/sop-geometry';
import { SOP_HIGH_RISK_BANNER, SOP_OPENING_MESSAGE, SOP_TERMINAL_MESSAGE } from '../../src/shared/sop-window';

const sopSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/SopApp.tsx'),
  'utf8',
);

function projectionFor(edgeIds: string[], role: 'agent' | 'coach' = 'agent') {
  let progress = startSopProgress(ALLERGY_SOP_TREE);
  for (const edgeId of edgeIds) {
    const next = chooseSopEdge(ALLERGY_SOP_TREE, progress, edgeId);
    expect(next).not.toBeNull();
    progress = next!;
  }
  return projectSop({
    tree: ALLERGY_SOP_TREE,
    progress,
    role,
    sessionId: 1,
  });
}

describe('SopApp injected projection', () => {
  afterEach(() => {
    cleanup();
    delete window.sopWindow;
  });

  it('does not import the SOP tree locally', () => {
    expect(sopSource).not.toContain('synthetic-sops');
    expect(sopSource).not.toContain('ALLERGY_SOP_TREE');
    expect(sopSource).not.toContain("from './features/search/ScriptCard'");
  });

  it('renders the voucher, severity, and explain screens from node kind', () => {
    const close = vi.fn(async () => undefined);
    const endFlow = vi.fn(async () => undefined);
    const copyCurrent = vi.fn(async () => ({ ok: true as const }));
    window.sopWindow = {
      close,
      endFlow,
      restart: vi.fn(async () => undefined),
      chooseEdge: vi.fn(async () => ({ ok: true as const })),
      nextStep: vi.fn(async () => ({ ok: true as const })),
      moveBy: vi.fn(async () => undefined),
      reportLayout: vi.fn(async () => ({ ok: true, sessionId: 1, sequence: 1, height: 320 })),
      copyCurrent,
      onProjection: () => () => undefined,
    };

    const { rerender } = render(<SopApp projection={projectionFor([])} />);
    expect(screen.getByTestId('sop-high-risk')).toHaveTextContent(SOP_HIGH_RISK_BANNER);
    expect(screen.getByTestId('sop-high-risk')).not.toHaveClass('is-error');
    expect(screen.getByTestId('script-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('script-card-1')).not.toHaveClass('is-lead');
    expect(screen.getByTestId('script-card-1').querySelector('kbd.rank')).toBeNull();
    expect(screen.queryByTestId('match-reason-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-inaccuracy-button-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sop-edge-no-photo')).toHaveTextContent('未给照片');
    expect(screen.getByTestId('sop-edge-has-photo')).toHaveTextContent('已给照片');
    expect(screen.getByTestId('sop-step')).toHaveTextContent('步骤 1');
    expect(screen.getByTestId('sop-step').textContent).not.toMatch(/\//);
    expect(screen.getByTestId('sop-chrome')).toHaveTextContent('过敏流程');
    expect(screen.getByTestId('sop-chrome')).not.toHaveTextContent('环节');
    expect(screen.getByTestId('sop-close')).toHaveAttribute('aria-label', '收起过敏流程，保留进度');
    expect(screen.queryByTestId('sop-prompt')).not.toBeInTheDocument();

    rerender(<SopApp projection={projectionFor(['has-photo'])} />);
    expect(screen.queryByTestId('script-card-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sop-high-risk')).not.toBeInTheDocument();
    expect(screen.getByTestId('sop-prompt')).toHaveTextContent('先判断不适程度，再选路径。');
    expect(screen.getByTestId('sop-edge-mild')).toHaveTextContent('轻微');
    expect(screen.getByTestId('sop-edge-severe')).toHaveTextContent('严重');

    rerender(<SopApp projection={projectionFor(['has-photo', 'severe'])} />);
    expect(screen.getByTestId('sop-prompt')).toHaveTextContent('严重路径需要话术师复核');
    expect(screen.queryByTestId('sop-internal-note')).not.toBeInTheDocument();

    rerender(<SopApp projection={projectionFor(['has-photo', 'severe'], 'coach')} />);
    expect(screen.queryByTestId('script-card-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sop-internal-note')).toHaveTextContent('内部说明 · 不要发给客户');
    expect(screen.getByTestId('sop-next')).toHaveTextContent('下一步');
  });

  it('copies for 1.2s without closing and Esc only remembers progress', () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => undefined);
    const endFlow = vi.fn(async () => undefined);
    const copyCurrent = vi.fn(async () => ({ ok: true as const }));
    window.sopWindow = {
      close,
      endFlow,
      restart: vi.fn(async () => undefined),
      chooseEdge: vi.fn(async () => ({ ok: true as const })),
      nextStep: vi.fn(async () => ({ ok: true as const })),
      moveBy: vi.fn(async () => undefined),
      reportLayout: vi.fn(async () => ({ ok: true, sessionId: 1, sequence: 1, height: 320 })),
      copyCurrent,
      onProjection: () => () => undefined,
    };
    render(<SopApp projection={projectionFor([])} />);
    fireEvent.keyDown(window, { key: '1' });
    expect(copyCurrent).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS);
    expect(close).not.toHaveBeenCalled();
    expect(endFlow).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    expect(endFlow).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports layout once when the same step is projected again', async () => {
    let emit: (projection: ReturnType<typeof projectionFor>) => void = () => undefined;
    const reportLayout = vi.fn(async () => ({ ok: true, sessionId: 1, sequence: 1, height: 320 }));
    window.sopWindow = {
      close: vi.fn(async () => undefined),
      endFlow: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      chooseEdge: vi.fn(async () => ({ ok: true as const })),
      nextStep: vi.fn(async () => ({ ok: true as const })),
      moveBy: vi.fn(async () => undefined),
      reportLayout,
      copyCurrent: vi.fn(async () => ({ ok: true as const })),
      onProjection: (cb) => {
        emit = cb;
        return () => undefined;
      },
    };

    render(<SopApp />);
    const first = projectionFor([]);
    emit(first);
    await waitFor(() => expect(reportLayout).toHaveBeenCalledTimes(1));
    emit({ ...first });
    await act(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(undefined));
      });
    });
    expect(reportLayout).toHaveBeenCalledTimes(1);
  });

  it('shows the opening shell copy', () => {
    render(<SopApp projection={{
      ...projectionFor([]),
      shellState: 'opening',
      nodeKind: 'opening',
      script: null,
      edges: [],
    }} />);
    expect(screen.getByTestId('sop-opening')).toHaveTextContent(SOP_OPENING_MESSAGE);
    expect(screen.queryByTestId('script-card-1')).not.toBeInTheDocument();
  });

  it('shows the terminal caption on a finished node', () => {
    const done = projectionFor(['no-photo']);
    render(<SopApp projection={done} />);
    expect(screen.getByTestId('sop-terminal')).toHaveTextContent(SOP_TERMINAL_MESSAGE);
  });
});
