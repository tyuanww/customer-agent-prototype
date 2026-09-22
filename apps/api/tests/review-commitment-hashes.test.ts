import { expect, it } from 'vitest';
import { reviewCommitmentHashes } from '../src/content-worker.js';

it('drops a manager hash that repeats the lead subject', () => {
  const same = reviewCommitmentHashes({
    leadSubject: 'same-person',
    managerSubject: 'same-person',
    evidenceId: 'EVD-FORMAL-REVIEW-001',
  });
  expect(same.managerHash).toBeUndefined();
  expect(same.leadHash).toHaveLength(64);

  const distinct = reviewCommitmentHashes({
    leadSubject: 'lead-person',
    managerSubject: 'manager-person',
    evidenceId: 'EVD-FORMAL-REVIEW-001',
  });
  expect(distinct.managerHash).toHaveLength(64);
  expect(distinct.managerHash).not.toBe(distinct.leadHash);
});
