import { expect, it } from 'vitest';
import { completeSignedInReview } from '../../src/main/dashboard-content';

const batchId = 'imp_page_1';
const revision = 'ab'.repeat(32);
const contentHash = 'cd'.repeat(32);

it('pages a string review revision and sends quality checks only for the initial sample', async () => {
  const calls: string[] = [];
  let qualityChecks = 0;
  const client = {
    view: () => ({ ok: true as const, enabled: true, signedIn: true, role: 'owner' as const, sessionEpoch: 1 }),
    request: async (_epoch: number, path: string, options?: { body?: { checks?: unknown[] } }) => {
      calls.push(path);
      if (path.startsWith('/v1/admin/content/reviews?')) {
        return { status: 200, value: { items: [{ batch_id: batchId, review_revision: revision }] } };
      }
      if (path.includes('after=0')) {
        return {
          status: 200,
          value: {
            items: [
              { script_id: 's0', content_hash: contentHash, initial_sample: true },
              { script_id: 's1', content_hash: contentHash, initial_sample: false },
            ],
            next_after: 2,
          },
        };
      }
      if (path.includes('after=2')) {
        return {
          status: 200,
          value: {
            items: [{ script_id: 's2', content_hash: contentHash, initial_sample: true }],
            next_after: null,
          },
        };
      }
      if (path.endsWith('/quality-evidence')) {
        qualityChecks = options?.body?.checks?.length ?? 0;
        return { status: 200, value: {} };
      }
      return { status: 200, value: {} };
    },
  };
  expect(await completeSignedInReview(client, 1, batchId)).toBe(true);
  expect(calls.filter((path) => path.endsWith('/decisions'))).toHaveLength(3);
  expect(qualityChecks).toBe(2);
  expect(calls.some((path) => path.includes('limit=100') && path.includes('after=2'))).toBe(true);
});

it('does not treat a numeric review revision as ready', async () => {
  const client = {
    view: () => ({ ok: true as const, enabled: true, signedIn: true, role: 'owner' as const, sessionEpoch: 1 }),
    request: async () => ({ status: 200, value: { items: [{ batch_id: batchId, review_revision: 3 }] } }),
  };
  expect(await completeSignedInReview(client, 1, batchId)).toBe(false);
});
