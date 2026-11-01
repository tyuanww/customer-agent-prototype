import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { findSopEntries } from '../../src/shared/sop-entry';
import { COPY_SUCCESS_MESSAGE } from '../../src/shared/contracts';
import { QueryResultsPane } from '../../src/renderer/features/search/QueryResultsPane';
import {
  FORBIDDEN_INACCURACY_STATUS_PHRASES,
  SCRIPT_INACCURACY_ACTION_LABEL,
  SCRIPT_INACCURACY_RECORDED_STATUS,
} from '../../src/renderer/features/search/query-view';
import type { QueryResult, RankedScript } from '../../src/renderer/features/search/types';

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
  onCopy?: (script: QueryResult, trigger: HTMLButtonElement | null) => void;
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
    const copyButton = screen.getByTestId('copy-button-1');
    await user.click(screen.getByText('复制话术'));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(script, copyButton);

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
    expect(screen.getByTestId('copy-button-1')).toBeDisabled();
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    for (const phrase of FORBIDDEN_INACCURACY_STATUS_PHRASES) {
      expect(screen.getByTestId('result-content').textContent).not.toContain(phrase);
    }
  });
});


function renderSopResults(overrides: Partial<ComponentProps<typeof QueryResultsPane>> = {}) {
  const onOpenSop = vi.fn();
  const onCopy = vi.fn();
  const props: ComponentProps<typeof QueryResultsPane> = {
    phase: 'RESULTS', resultPaneRef: null, statusBannerRef: null, resultContentRef: null,
    errorMessage: '', results: [rankedScript({ scriptId: 'syn-after-002' })], copying: false,
    copiedRank: null, onRetry: vi.fn(), onCopy, onOpenSop, sopEntryVisible: true,
    sopEntries: findSopEntries('过敏了怎么办还有少件'), ...overrides,
  };
  return { ...render(<QueryResultsPane {...props} />), onOpenSop, onCopy, props };
}

describe('SOP entry association', () => {
  it.each([1, 2, 3] satisfies RankedScript['rank'][])('offers the linked SOP at rank %s alongside ordinary copy', async rank => {
    const user = userEvent.setup();
    const script = rankedScript({ scriptId: 'syn-after-002', rank });
    const { onOpenSop, onCopy } = renderSopResults({ results: [script] });
    const card = screen.getByTestId(`script-card-${rank}`);
    const publicEntries = screen.getByRole('group', { name: '本次查询相关流程' });
    expect(within(publicEntries).getByRole('button', { name: '进入过敏流程' })).toBeVisible();
    expect(within(publicEntries).getByRole('button', { name: '进入少件处理' })).toBeVisible();
    expect(within(card).queryByRole('button', { name: '进入少件处理' })).toBeNull();
    await user.click(within(card).getByRole('button', { name: '进入过敏流程' }));
    expect(onOpenSop).toHaveBeenLastCalledWith('allergy-aftersale-demo');
    expect(onCopy).not.toHaveBeenCalled();
    await user.click(within(publicEntries).getByRole('button', { name: '进入少件处理' }));
    expect(onOpenSop).toHaveBeenLastCalledWith('missing-item-demo');
    await user.click(within(card).getByRole('button', { name: '复制话术' }));
    expect(onCopy).toHaveBeenCalledWith(script, expect.any(HTMLButtonElement));
  });
  it.each(['syn-pre-001', 'unknown-script'])('does not infer a link from the title, text, or rank of %s', scriptId => {
    renderSopResults({ results: [rankedScript({ scriptId, scopeLabel: '过敏应急', answerText: '过敏了怎么办' })] });
    expect(screen.getByRole('group', { name: '本次查询相关流程' })).toBeVisible();
    expect(within(screen.getByTestId('script-card-1')).queryByRole('button', { name: /^进入/ })).toBeNull();
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
  });
  it('does not apply synthetic links to product rows with the same script ID', () => {
    renderSopResults({ results: [rankedScript({ scriptId: 'syn-after-002', productCopy: {
      sessionEpoch: 1, generation: 1, queryId: 'query', rank: 1, scriptId: 'syn-after-002', scriptVersion: 1, contentHash: 'hash',
    } })] });
    expect(screen.queryByRole('button', { name: /^进入/ })).toBeNull();
    expect(screen.queryByTestId('sop-query-entry')).toBeNull();
  });
  it('does not apply synthetic links to native FAQ rows', () => {
    renderSopResults({ results: [{ kind: 'intake', key: 'syn-after-002', rank: 1, title: '过敏', answerText: '合成FAQ',
      applicabilityNote: '', riskNote: '', releaseId: 'synthetic-release', validUntil: '2099-12-31' }] });
    expect(screen.queryByRole('button', { name: /^进入/ })).toBeNull();
    expect(screen.queryByTestId('sop-query-entry')).toBeNull();
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
  });
  it('only uses associations among the current query entries', () => {
    renderSopResults({ sopEntries: findSopEntries('少件') });
    expect(within(screen.getByTestId('script-card-1')).queryByRole('button', { name: /^进入/ })).toBeNull();
    expect(screen.getByRole('button', { name: '进入少件处理' })).toBeVisible();
  });
  it.each([
    { sopEntryVisible: false }, { sopEntryResume: true }, { phase: 'ERROR' }, { onOpenSop: undefined },
  ] satisfies Partial<ComponentProps<typeof QueryResultsPane>>[])('hides all entries when unavailable: %j', props => {
    renderSopResults(props);
    expect(screen.queryByRole('button', { name: /^进入/ })).toBeNull();
  });
  it('disables both entry surfaces while opening without disabling ordinary copy', () => {
    renderSopResults({ sopEntryBusy: true });
    for (const entry of screen.getAllByRole('button', { name: /^进入/ })) expect(entry).toBeDisabled();
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
  });
  it('keeps the existing no-hit entry when only an SOP matches', async () => {
    const user = userEvent.setup();
    const { onOpenSop } = renderSopResults({ phase: 'EMPTY', results: [], sopEntries: findSopEntries('少件') });
    expect(screen.getByTestId('sop-no-hit-entry')).toBeVisible();
    expect(screen.queryByTestId('sop-query-entry')).toBeNull();
    await user.click(screen.getByTestId('sop-no-hit-open-missing-item-demo'));
    expect(onOpenSop).toHaveBeenCalledWith('missing-item-demo');
  });
});
