import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { COPY_SUCCESS_MESSAGE } from '../../src/shared/contracts';
import { QueryResultsPane } from '../../src/renderer/features/search/QueryResultsPane';
import {
  FORBIDDEN_INACCURACY_STATUS_PHRASES,
  SCRIPT_INACCURACY_ACTION_LABEL,
  SCRIPT_INACCURACY_RECORDED_STATUS,
} from '../../src/renderer/features/search/query-view';
import type { RankedScript } from '../../src/renderer/features/search/types';

function rankedScript(overrides: Partial<RankedScript> = {}): RankedScript {
  return {
    scriptId: 'syn-prod-001',
    rank: 1,
    domain: '产品',
    questionVariants: ['澄芽氨基酸洁面怎么用'],
    answerText: '合成话术正文',
    platform: '私域企微',
    scopeLabel: '日常清洁 · 合成演示',
    riskLevel: 'low',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
    score: 1,
    matchKind: 'exact',
    matchLabel: '精确问法',
    ...overrides,
  };
}

function renderResults(input: {
  results?: RankedScript[];
  copiedRank?: 1 | 2 | 3 | null;
  onCopy?: (script: RankedScript, trigger: HTMLButtonElement | null) => void;
} = {}) {
  const onCopy = input.onCopy ?? vi.fn();
  render(
    <QueryResultsPane
      phase="RESULTS"
      resultPaneRef={null}
      statusBannerRef={null}
      resultContentRef={null}
      errorMessage=""
      results={input.results ?? [rankedScript()]}
      copying={false}
      copiedRank={input.copiedRank ?? null}
      onRetry={() => {}}
      onCopy={onCopy}
    />,
  );
  return { onCopy };
}

describe('QueryResultsPane script inaccuracy report', () => {
  it('does not show the inaccuracy control on empty results', () => {
    render(
      <QueryResultsPane
        phase="EMPTY"
        resultPaneRef={null}
        statusBannerRef={null}
        resultContentRef={null}
        errorMessage=""
        results={[]}
        copying={false}
        copiedRank={null}
        onRetry={() => {}}
        onCopy={vi.fn()}
        onCopyContact={() => {}}
        onOpenHelp={() => {}}
        onLeaveNoHit={() => {}}
      />,
    );

    expect(screen.getByTestId('no-hit')).toBeInTheDocument();
    expect(screen.queryByTestId('report-inaccuracy-button-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
  });

  it('shows a hairline report control on result cards, including high-risk scripts', () => {
    renderResults({
      results: [
        rankedScript({ rank: 1, scriptId: 'syn-after-002', riskLevel: 'high' }),
        rankedScript({ rank: 2, scriptId: 'syn-prod-001', riskLevel: 'low' }),
      ],
    });

    const leadReport = screen.getByTestId('report-inaccuracy-button-1');
    expect(leadReport).toHaveTextContent(SCRIPT_INACCURACY_ACTION_LABEL);
    expect(leadReport).toHaveClass('retry-btn');
    expect(leadReport).not.toHaveClass('copy-btn');
    expect(screen.getByTestId('report-inaccuracy-button-2')).toHaveClass('retry-btn');
    expect(screen.getByTestId('risk-1')).toHaveTextContent('高风险');
    expect(screen.getByTestId('copy-button-1')).toHaveClass('copy-btn');
    expect(screen.getByTestId('copy-button-1')).toHaveTextContent('复制话术');
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
  });

  it('records a local inaccuracy report without claiming it was processed or sent', async () => {
    const user = userEvent.setup();
    const { onCopy } = renderResults({
      results: [rankedScript({ rank: 1, scriptId: 'syn-after-002', riskLevel: 'high' })],
    });

    await user.click(screen.getByTestId('report-inaccuracy-button-1'));

    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    expect(screen.getByTestId('report-inaccuracy-button-1')).toBeDisabled();
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    for (const phrase of FORBIDDEN_INACCURACY_STATUS_PHRASES) {
      expect(screen.getByTestId('result-content').textContent).not.toContain(phrase);
    }
  });

  it('keeps copy success as 已复制 after an inaccuracy report', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const script = rankedScript();
    const { rerender } = render(
      <QueryResultsPane
        phase="RESULTS"
        resultPaneRef={null}
        statusBannerRef={null}
        resultContentRef={null}
        errorMessage=""
        results={[script]}
        copying={false}
        copiedRank={null}
        onRetry={() => {}}
        onCopy={onCopy}
      />,
    );

    await user.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    await user.click(screen.getByTestId('copy-button-1'));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(script, expect.any(HTMLButtonElement));

    rerender(
      <QueryResultsPane
        phase="COPIED"
        resultPaneRef={null}
        statusBannerRef={null}
        resultContentRef={null}
        errorMessage=""
        results={[script]}
        copying
        copiedRank={1}
        onRetry={() => {}}
        onCopy={onCopy}
      />,
    );

    expect(screen.getByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.getByTestId('copy-button-1')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    for (const phrase of FORBIDDEN_INACCURACY_STATUS_PHRASES) {
      expect(screen.getByTestId('result-content').textContent).not.toContain(phrase);
    }
  });
});
