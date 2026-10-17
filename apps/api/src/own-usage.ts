export type OwnUsageEvent = Readonly<{
  userId: string;
  queryId: string;
  askedAt: string;
  question: string | null;
  hit: boolean;
  copied: boolean;
  consented: boolean;
}>;

export type OwnUsageRow = Readonly<{
  id: string;
  askedAt: string;
  agent: string;
  question: string | null;
  scriptTitle: string | null;
  result: 'copied' | 'viewed' | 'miss';
  snapshotStale: boolean;
  consented: boolean;
}>;

export const OWN_USAGE_SQL = `SELECT q.query_id, q.user_id, q.created_at, q.query_text_redacted,
            q.hit_status, q.text_storage_status,
            EXISTS (
              SELECT 1 FROM public.adoption_events a
              WHERE a.query_id = q.query_id AND a.user_id = q.user_id AND a.outcome = 'adopted'
            ) AS copied
     FROM public.query_events q
     WHERE q.user_id = $1
     ORDER BY q.created_at DESC
     LIMIT 500`;

export function ownUsageRows(events: readonly OwnUsageEvent[], actorUserId: string): OwnUsageRow[] {
  const rows: OwnUsageRow[] = [];
  for (const event of events) {
    if (event.userId !== actorUserId) continue;
    rows.push({
      id: event.queryId,
      askedAt: event.askedAt,
      agent: '坐席',
      question: event.question,
      scriptTitle: null,
      result: event.copied ? 'copied' : event.hit ? 'viewed' : 'miss',
      snapshotStale: false,
      consented: event.consented,
    });
  }
  return rows;
}
