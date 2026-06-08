-- 20240101000074_feedback_center.sql
--
-- Feedback Center (Phase 1) — unified submissions + votes.
--
-- Two tables intentionally:
--   feedback_submissions — everything the user explicitly writes:
--     rating, review, question, bug report, feature request.
--   feedback_votes — lightweight votes/reactions on EITHER a submission
--     (upvote a feature request) OR a content target (react to a signal
--     or educational post). One row per (user, target).
--
-- Spam prevention is rate-limited at the API layer (5 submissions/user/h);
-- the DB itself only enforces structural constraints.
--
-- RLS model: users read+write their own rows. Admin paths use the
-- service-role client (same pattern as growth_content_items) so admin
-- triage / responses bypass RLS naturally without needing a per-table
-- admin policy that depends on a profiles.role column.

-- ─── feedback_submissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The kind of submission. Drives the form on /feedback + the badge
  -- in the admin triage list.
  type          TEXT NOT NULL CHECK (type IN ('rating','question','bug','feature','review')),

  -- Required for type='rating' (1..5). NULL for everything else.
  rating        SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),

  -- One-line headline (e.g. "Signal feed slow on iPad"). Required for
  -- everything except pure star ratings; ratings have rating + body
  -- where body is the optional review.
  subject       TEXT,

  -- The body — review text / question / bug description / feature
  -- pitch. NULL allowed for pure star ratings.
  body          TEXT,

  -- What is this ABOUT. Optional but useful for ratings + bug reports.
  -- target_kind examples: 'signal', 'content_item', 'feature', 'route', 'platform'
  -- target_id can be a UUID, a slug, a route path — caller's choice.
  target_kind   TEXT,
  target_id     TEXT,

  -- Bugs only — 'low' | 'medium' | 'high' | 'critical'.
  severity      TEXT CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),

  -- Workflow status. Same enum across all types so the admin triage
  -- UI is one list, not five.
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_review','answered','resolved','closed','rejected')),

  -- Admin response (visible to the submitter on their /feedback page).
  admin_response TEXT,
  responded_at   TIMESTAMPTZ,
  responded_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Source surface — where the submission came from. 'web' | 'telegram' |
  -- 'discord' | 'admin'. Useful for analytics.
  source        TEXT NOT NULL DEFAULT 'web',

  -- Soft delete — set when admin or user removes the submission so we
  -- preserve the audit trail.
  deleted_at    TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical indexes for the user history page + admin triage.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user
  ON public.feedback_submissions (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_open
  ON public.feedback_submissions (status, created_at DESC)
  WHERE deleted_at IS NULL AND status IN ('open','in_review');

-- Bug-report severity priority for the admin queue.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_severity
  ON public.feedback_submissions (severity, created_at DESC)
  WHERE deleted_at IS NULL AND type = 'bug' AND severity IN ('high','critical');

-- Per-target lookups (e.g. average rating for a specific signal).
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_target
  ON public.feedback_submissions (target_kind, target_id)
  WHERE deleted_at IS NULL AND target_kind IS NOT NULL;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.set_feedback_submissions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS feedback_submissions_updated_at ON public.feedback_submissions;
CREATE TRIGGER feedback_submissions_updated_at
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_feedback_submissions_updated_at();

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_submissions_own_read"   ON public.feedback_submissions;
DROP POLICY IF EXISTS "feedback_submissions_own_insert" ON public.feedback_submissions;
DROP POLICY IF EXISTS "feedback_submissions_own_update" ON public.feedback_submissions;

CREATE POLICY "feedback_submissions_own_read"
  ON public.feedback_submissions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "feedback_submissions_own_insert"
  ON public.feedback_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can soft-delete their own submission (UPDATE deleted_at) and
-- update their own subject/body/rating BEFORE an admin has responded.
-- After responded_at is set the row is immutable from the user side.
CREATE POLICY "feedback_submissions_own_update"
  ON public.feedback_submissions FOR UPDATE
  USING (auth.uid() = user_id AND responded_at IS NULL);


-- ─── feedback_votes ────────────────────────────────────────────────
-- Lightweight one-row-per-vote table. Used for:
--   1. Upvoting feature requests → submission_id set, target_* NULL.
--   2. Reacting to a content piece (👍 helpful, 🎯 accurate, etc.) →
--      target_kind + target_id set, submission_id NULL.
-- The CHECK below enforces exactly one of those modes.

CREATE TABLE IF NOT EXISTS public.feedback_votes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Mode 1: vote on a submission (feature-request upvote).
  submission_id  UUID REFERENCES public.feedback_submissions(id) ON DELETE CASCADE,

  -- Mode 2: react to an arbitrary target (signal, content_item, feature).
  target_kind    TEXT,
  target_id      TEXT,

  -- The vote/reaction itself.
  --   For mode 1 (submission upvotes): 'up' | 'down'
  --   For mode 2 (content reactions):  'helpful' | 'not_helpful' | 'accurate' | 'excellent' | 'needs_improvement'
  reaction       TEXT NOT NULL
                 CHECK (reaction IN ('up','down','helpful','not_helpful','accurate','excellent','needs_improvement')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one mode. Either submission_id is set, or both target_*
  -- are set. Not both, not neither.
  CONSTRAINT feedback_votes_mode_check CHECK (
    (submission_id IS NOT NULL AND target_kind IS NULL AND target_id IS NULL)
    OR
    (submission_id IS NULL AND target_kind IS NOT NULL AND target_id IS NOT NULL)
  )
);

-- One vote per (user, submission). Prevents stacking upvotes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_votes_user_submission
  ON public.feedback_votes (user_id, submission_id)
  WHERE submission_id IS NOT NULL;

-- One reaction per (user, target). Updating switches the reaction
-- rather than creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_votes_user_target
  ON public.feedback_votes (user_id, target_kind, target_id)
  WHERE target_kind IS NOT NULL;

-- Aggregate query support — fetch all votes for a feature request.
CREATE INDEX IF NOT EXISTS idx_feedback_votes_submission
  ON public.feedback_votes (submission_id)
  WHERE submission_id IS NOT NULL;

-- Aggregate query support — fetch all reactions on a content target.
CREATE INDEX IF NOT EXISTS idx_feedback_votes_target
  ON public.feedback_votes (target_kind, target_id)
  WHERE target_kind IS NOT NULL;

ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_votes_own_read"   ON public.feedback_votes;
DROP POLICY IF EXISTS "feedback_votes_own_insert" ON public.feedback_votes;
DROP POLICY IF EXISTS "feedback_votes_own_update" ON public.feedback_votes;
DROP POLICY IF EXISTS "feedback_votes_own_delete" ON public.feedback_votes;

-- Aggregate vote counts on feature requests / content targets are read
-- via service-role from the API; per-user SELECT is scoped to the
-- caller's own votes (so the UI can highlight "you voted").
CREATE POLICY "feedback_votes_own_read"
  ON public.feedback_votes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "feedback_votes_own_insert"
  ON public.feedback_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "feedback_votes_own_update"
  ON public.feedback_votes FOR UPDATE
  USING (auth.uid() = user_id);

-- Removing a vote = DELETE. Toggling a reaction = UPDATE the row.
CREATE POLICY "feedback_votes_own_delete"
  ON public.feedback_votes FOR DELETE
  USING (auth.uid() = user_id);


COMMENT ON TABLE public.feedback_submissions IS
  'Phase 1 Feedback Center — ratings/reviews/questions/bugs/features. Service-role for admin triage; RLS scopes user reads/writes to their own rows.';
COMMENT ON TABLE public.feedback_votes IS
  'Phase 1 Feedback Center — votes on submissions + reactions on content. Polymorphic via either submission_id or target_kind+target_id (mutually exclusive via CHECK).';
