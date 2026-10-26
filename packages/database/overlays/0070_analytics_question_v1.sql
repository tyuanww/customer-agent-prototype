-- The overview window is an argument, so this cannot be a parameterless view.
-- A suppressed query still counts. other_count stays out of no_hit.
-- Rates stay null when the window has no queries. An open or reversed window errors.
-- The caller is app_owner_read. The function runs as cs_ai_definer, the same
-- split as 0018: EXECUTE on this function, no SELECT on the base tables.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE SCHEMA analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
ALTER SCHEMA analytics OWNER TO cs_ai_definer;
GRANT USAGE ON SCHEMA analytics TO app_owner_read;

CREATE FUNCTION analytics.question_v1(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (
  query_count bigint,
  hit_count bigint,
  no_hit_count bigint,
  other_count bigint,
  inaccuracy_count bigint,
  hit_rate numeric,
  no_hit_rate numeric,
  inaccuracy_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'analytics.question_v1 requires p_start and p_end, with p_start <= p_end';
  END IF;
  RETURN QUERY
  SELECT
    counts.query_count,
    counts.hit_count,
    counts.no_hit_count,
    counts.other_count,
    reports.inaccuracy_count,
    CASE WHEN counts.query_count = 0 THEN NULL
      ELSE counts.hit_count::numeric / counts.query_count::numeric END,
    CASE WHEN counts.query_count = 0 THEN NULL
      ELSE counts.no_hit_count::numeric / counts.query_count::numeric END,
    CASE WHEN counts.query_count = 0 THEN NULL
      ELSE reports.inaccuracy_count::numeric / counts.query_count::numeric END
  FROM (
    SELECT
      count(*)::bigint AS query_count,
      count(*) FILTER (WHERE event.hit_status = 'hit')::bigint AS hit_count,
      count(*) FILTER (WHERE event.hit_status = 'no_hit')::bigint AS no_hit_count,
      count(*) FILTER (
        WHERE event.hit_status IS DISTINCT FROM 'hit'
          AND event.hit_status IS DISTINCT FROM 'no_hit'
      )::bigint AS other_count
    FROM public.query_events AS event
    WHERE event.created_at >= p_start
      AND event.created_at <= p_end
  ) AS counts
  CROSS JOIN (
    SELECT count(*)::bigint AS inaccuracy_count
    FROM ops_loop.inaccuracy_reports AS report
    WHERE report.created_at >= p_start
      AND report.created_at <= p_end
  ) AS reports;
END;
$$;

ALTER FUNCTION analytics.question_v1(timestamptz, timestamptz) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION analytics.question_v1(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.question_v1(timestamptz, timestamptz) TO app_owner_read;
