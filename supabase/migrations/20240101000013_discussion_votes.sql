-- ============================================================
-- AlgoSphere Quant — Discussion vote RPC
-- Migration: 20240101000013_discussion_votes.sql
-- Atomic up/down voting on threads + replies with score sync.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cast_vote(
  p_target_type TEXT,         -- 'thread' | 'reply'
  p_target_id   UUID,
  p_vote        SMALLINT      -- 1 (up) | -1 (down) | 0 (clear)
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_existing  SMALLINT;
  v_delta     INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_target_type NOT IN ('thread', 'reply') THEN
    RAISE EXCEPTION 'Invalid target_type';
  END IF;
  IF p_vote NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'Invalid vote value';
  END IF;

  -- Current vote (if any)
  SELECT vote INTO v_existing
  FROM   public.discussion_votes
  WHERE  target_type = p_target_type
    AND  target_id   = p_target_id
    AND  user_id     = v_user;

  IF p_vote = 0 THEN
    -- Clear vote
    IF v_existing IS NOT NULL THEN
      DELETE FROM public.discussion_votes
      WHERE target_type = p_target_type
        AND target_id   = p_target_id
        AND user_id     = v_user;
      v_delta := -v_existing;
    END IF;
  ELSE
    IF v_existing IS NULL THEN
      INSERT INTO public.discussion_votes (target_type, target_id, user_id, vote)
      VALUES (p_target_type, p_target_id, v_user, p_vote);
      v_delta := p_vote;
    ELSIF v_existing <> p_vote THEN
      UPDATE public.discussion_votes
      SET    vote = p_vote
      WHERE  target_type = p_target_type
        AND  target_id   = p_target_id
        AND  user_id     = v_user;
      v_delta := p_vote - v_existing;   -- e.g. -1 → +1 = delta +2
    ELSE
      v_delta := 0;   -- same vote, no-op
    END IF;
  END IF;

  -- Sync aggregate score
  IF v_delta <> 0 THEN
    IF p_target_type = 'thread' THEN
      UPDATE public.discussion_threads
      SET    votes_score = votes_score + v_delta
      WHERE  id = p_target_id;
    ELSE
      UPDATE public.discussion_replies
      SET    votes_score = votes_score + v_delta
      WHERE  id = p_target_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vote',  COALESCE(NULLIF(p_vote, 0), NULL),
    'delta', v_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_vote TO authenticated;

-- Helper: get current user's vote on a target
CREATE OR REPLACE FUNCTION public.my_vote(
  p_target_type TEXT,
  p_target_id   UUID
)
RETURNS SMALLINT
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT vote FROM public.discussion_votes
  WHERE  target_type = p_target_type
    AND  target_id   = p_target_id
    AND  user_id     = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_vote TO authenticated;
