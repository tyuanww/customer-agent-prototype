// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { bindDashboardReleaseInvalidation } from '../../src/main/integration/desktop-composition';

it('routes one DSH invalidation through typed Query cancellation and stale-copy clearing', () => {
  const work = { cancelQuery: vi.fn(), cancelCopy: vi.fn(), clearContent: vi.fn() };
  const onInvalidation = bindDashboardReleaseInvalidation({
    getOverlaySnapshot: () => ({ contract: { sessionEpoch: 4, generation: 9 } } as never),
    work,
  });
  const value = { operationId: 'op-1', dedupeKey: 'epoch:4:op-1:release-2', domain: 'release', sessionEpoch: 4, releaseId: 'release-2' } as never;
  onInvalidation(value);
  onInvalidation(value);
  expect(work.cancelQuery).toHaveBeenCalledOnce();
  expect(work.cancelQuery).toHaveBeenCalledWith({ sessionEpoch: 4, generation: 9 });
  expect(work.cancelCopy).toHaveBeenCalledWith({ sessionEpoch: 4, generation: 9 });
  expect(work.clearContent).toHaveBeenCalledOnce();
});

it('does not send a command without an authoritative overlay snapshot', () => {
  const work = { cancelQuery: vi.fn(), cancelCopy: vi.fn(), clearContent: vi.fn() };
  bindDashboardReleaseInvalidation({ getOverlaySnapshot: () => null, work })({} as never);
  expect(work.cancelQuery).not.toHaveBeenCalled();
  expect(work.cancelCopy).not.toHaveBeenCalled();
  expect(work.clearContent).not.toHaveBeenCalled();
});
