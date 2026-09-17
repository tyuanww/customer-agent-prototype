import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByTestId('script-card-1')).toBeInTheDocument();
    expect(screen.queryByTestId('report-inaccuracy-button-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sop-edge-no-photo')).toHaveTextContent('未给照片');
    expect(screen.getByTestId('sop-edge-has-photo')).toHaveTextContent('已给照片');
    expect(screen.getByTestId('sop-step')).toHaveTextContent('步骤 1');
    expect(screen.getByTestId('sop-step').textContent).not.toMatch(/\//);

    rerender(<SopApp projection={projectionFor(['has-photo'])} />);
    expect(screen.queryByTestId('script-card-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sop-edge-mild')).toHaveTextContent('轻微');
    expect(screen.getByTestId('sop-edge-severe')).toHaveTextContent('严重');

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
    fireEvent.click(screen.getByTestId('copy-button-1'));
    expect(copyCurrent).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS);
    expect(close).not.toHaveBeenCalled();
    expect(endFlow).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    expect(endFlow).not.toHaveBeenCalled();
    vi.useRealTimers();
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
