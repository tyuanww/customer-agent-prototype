import { expect, it } from 'vitest';
import { OWN_USAGE_SQL, ownUsageRows, type OwnUsageEvent } from '../src/own-usage.js';

const events: OwnUsageEvent[] = [
  {
    userId: 'usr_self',
    queryId: 'q-self',
    askedAt: '2026-10-13T01:00:00.000Z',
    question: '退货多久',
    hit: true,
    copied: true,
    consented: true,
  },
  {
    userId: 'usr_other',
    queryId: 'q-other',
    askedAt: '2026-10-13T02:00:00.000Z',
    question: '别人的地址',
    hit: false,
    copied: false,
    consented: true,
  },
  {
    userId: 'usr_self',
    queryId: 'q-miss',
    askedAt: '2026-10-13T03:00:00.000Z',
    question: null,
    hit: false,
    copied: false,
    consented: false,
  },
];

it('lists only the caller and drops another seat', () => {
  const rows = ownUsageRows(events, 'usr_self');
  expect(rows.map((row) => row.id)).toEqual(['q-self', 'q-miss']);
  expect(rows.map((row) => row.question)).toEqual(['退货多久', null]);
  expect(rows.some((row) => row.question === '别人的地址')).toBe(false);
  expect(rows[0]).toMatchObject({ result: 'copied', consented: true, agent: '坐席', scriptTitle: null });
  expect(rows[1]).toMatchObject({ result: 'miss', consented: false });
  expect(ownUsageRows(events, 'usr_missing')).toEqual([]);
});

it('reads query_events by the bound actor only', () => {
  expect(OWN_USAGE_SQL).toContain('WHERE q.user_id = $1');
  expect(OWN_USAGE_SQL).not.toContain('$2');
});
