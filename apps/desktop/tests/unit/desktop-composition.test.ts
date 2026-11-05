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

it('fences durable invalidation by session, while release identity remains non-ordered', () => {
  const work = { cancelQuery: vi.fn(), cancelCopy: vi.fn(), clearContent: vi.fn() };
  const onInvalidation = bindDashboardReleaseInvalidation({
    getOverlaySnapshot: () => ({ contract: { sessionEpoch: 7, generation: 11 } } as never),
    work,
  });
  const oldSession = {
    operationId: 'op-old', dedupeKey: 'epoch:4:op-old:release-old', domain: 'release',
    sessionEpoch: 4, releaseId: 'release-old',
  } as never;
  const currentRelease = {
    operationId: 'op-current', dedupeKey: 'epoch:7:op-current:release-old', domain: 'release',
    sessionEpoch: 7, releaseId: 'release-old',
  } as never;
  const nextRelease = {
    operationId: 'op-next', dedupeKey: 'epoch:7:op-next:release-new', domain: 'release',
    sessionEpoch: 7, releaseId: 'release-new',
  } as never;

  onInvalidation(oldSession);
  onInvalidation(currentRelease);
  onInvalidation(nextRelease);

  expect(work.cancelQuery).toHaveBeenCalledTimes(2);
  expect(work.cancelCopy).toHaveBeenCalledTimes(2);
  expect(work.clearContent).toHaveBeenCalledTimes(2);
  expect(work.cancelQuery).toHaveBeenNthCalledWith(1, { sessionEpoch: 7, generation: 11 });
  expect(work.cancelQuery).toHaveBeenNthCalledWith(2, { sessionEpoch: 7, generation: 11 });
});

it('does not consume a durable key without a snapshot, then consumes it once after a snapshot appears', () => {
  const work = { cancelQuery: vi.fn(), cancelCopy: vi.fn(), clearContent: vi.fn() };
  let snapshot: object | null = null;
  const onInvalidation = bindDashboardReleaseInvalidation({
    getOverlaySnapshot: () => snapshot as never,
    work,
  });
  const value = { operationId: 'op-1', dedupeKey: 'epoch:4:op-1:release-2', domain: 'release', sessionEpoch: 4, releaseId: 'release-2' } as never;
  onInvalidation(value);
  expect(work.cancelQuery).not.toHaveBeenCalled();
  expect(work.cancelCopy).not.toHaveBeenCalled();
  expect(work.clearContent).not.toHaveBeenCalled();

  snapshot = { contract: { sessionEpoch: 4, generation: 9 } };
  onInvalidation(value);
  onInvalidation(value);
  expect(work.cancelQuery).toHaveBeenCalledOnce();
  expect(work.cancelCopy).toHaveBeenCalledOnce();
  expect(work.clearContent).toHaveBeenCalledOnce();
});
