-- Product overlay (not a frozen contract snapshot slice).
-- Owner "roll back to the previous release" target resolution.
--
-- Why this exists: POST /v1/content/rollback is implemented and owner-only, but there is no
-- endpoint that lists content releases, so an operator cannot choose target_release_id. Rather
-- than add a list API (a new read surface plus a new contract shape), resolve the most recent
-- prior published release server-side. "I just published the wrong thing, put the last one back"
-- is the case that actually happens; choosing an arbitrary older release needs the list API and
-- is deliberately not covered here.
--
-- Resolution reads content_releases, which app_content_admin deliberately cannot SELECT (0008
-- grants it EXECUTE only). So the lookup is a SECURITY DEFINER function owned by cs_ai_definer,
-- matching how every other admin path reaches content state.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION public.resolve_previous_content_release(p_actor_role TEXT)
RETURNS TABLE(release_id TEXT, release_seq BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_current_id TEXT;
  v_current_seq BIGINT;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA005',
      MESSAGE = 'previous-release resolution requires owner',
      DETAIL = 'FORBIDDEN';
  END IF;

  SELECT cc.current_release_id INTO v_current_id FROM public.content_current cc WHERE cc.id = 1;
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA002',
      MESSAGE = 'no current release',
      DETAIL = 'NOT_FOUND';
  END IF;

  SELECT cr.release_seq INTO v_current_seq
  FROM public.content_releases cr WHERE cr.release_id = v_current_id;
  IF v_current_seq IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA002',
      MESSAGE = 'current release is missing from the release ledger',
      DETAIL = 'NOT_FOUND';
  END IF;

  -- Highest release_seq strictly below the current one. The rollback function re-validates the
  -- target (complete source set, no suspended source, governance hash, owner acceptance) and
  -- raises its own typed errors, so this only has to pick the candidate.
  --
  -- release_seq is UNIQUE, so at most one row matches and this is a total order. An empty
  -- predicate (nothing older) leaves release_id NULL; PL/pgSQL then returns one row whose
  -- release_id is NULL, which the caller must treat as NOT_FOUND. Note this is deliberately NOT
  -- a bare `RETURN QUERY` on a possibly-empty set, which would return zero rows and make
  -- "nothing older" indistinguishable from "the function never ran".
  IF NOT EXISTS (
    SELECT 1 FROM public.content_releases cr
    WHERE cr.release_seq < v_current_seq AND cr.status IN ('published', 'superseded')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cr.release_id, cr.release_seq
  FROM public.content_releases cr
  WHERE cr.release_seq < v_current_seq AND cr.status IN ('published', 'superseded')
  ORDER BY cr.release_seq DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_previous_content_release(TEXT) FROM PUBLIC;

GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.resolve_previous_content_release(TEXT) OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;

-- Only the admin pool reaches content state; the service authenticates owner before it calls this.
GRANT EXECUTE ON FUNCTION public.resolve_previous_content_release(TEXT) TO app_content_admin;
