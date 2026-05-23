-- ============================================================
-- AlgoSphere — AI Trading Coach: behavioral analytics (Phase 4)
-- Migration: 20240101000038_ai_coach.sql
--
-- The coach is ANALYZE-ONLY. It reads the (auto-populated) journal_entries
-- and writes behavioral findings — it NEVER executes, sizes, or gates a
-- trade. If the coach worker is offline, trading is wholly unaffected;
-- alerts simply stop. (Matches the §3.9 design in PRODUCT_ARCHITECTURE.md.)
--
--   coach_state   — one rolling-window scorecard per user: discipline score
--                   + the behavioral metrics behind it.
--   coach_alerts  — discrete behavioral findings (revenge / oversizing /
--                   loss-streak / overtrade / sizing-drift / win-rate-drop),
--                   de-duplicated while open, acknowledgeable by the user.
--   coach_reports — periodic PM-style summaries (daily/weekly/monthly).
--
-- Deliberately NO LLM dependency: every metric here is deterministic and
-- computed in the worker from trade history. An LLM narration layer can be
-- layered on later, reading these rows — it is not required for the core.
--
-- Strictly additive; RLS owner-read, service_role-write.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.coach_state (
  user_id                 UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_days             INTEGER NOT NULL DEFAULT 30,
  trades                  INTEGER NOT NULL DEFAULT 0,
  discipline_score        NUMERIC(5,2),          -- 0..100, NULL when too few trades
  win_rate                NUMERIC(5,2),
  win_rate_after_losses   NUMERIC(5,2),          -- after >=2 consecutive losses
  current_loss_streak     INTEGER NOT NULL DEFAULT 0,
  max_loss_streak         INTEGER NOT NULL DEFAULT 0,
  revenge_events          INTEGER NOT NULL DEFAULT 0,
  oversize_events         INTEGER NOT NULL DEFAULT 0,
  trades_per_active_hour  NUMERIC(8,2),
  sizing_cv               NUMERIC(8,4),          -- coefficient of variation of lot size
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_state_owner"  ON public.coach_state FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "coach_state_system" ON public.coach_state FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.coach_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'revenge','overtrade','oversizing','loss_streak',
                  'consistency_drift','winrate_drop')),
  severity      TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','critical')),
  title         TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_alerts_open
  ON public.coach_alerts (user_id, kind, created_at DESC)
  WHERE acknowledged = FALSE;

ALTER TABLE public.coach_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_alerts_owner_read" ON public.coach_alerts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "coach_alerts_owner_ack"  ON public.coach_alerts FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "coach_alerts_system"     ON public.coach_alerts FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.coach_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('daily','weekly','monthly')),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  body_markdown TEXT NOT NULL,
  metrics       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, scope, period_start)
);

ALTER TABLE public.coach_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_reports_owner"  ON public.coach_reports FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "coach_reports_system" ON public.coach_reports FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- The coach worker (apps/copy-engine/coach.py) reads each active user's
-- recent journal_entries, computes coach_state, raises de-duplicated
-- coach_alerts, and writes a daily coach_report. All read-only against the
-- trading path — it cannot affect execution.
-- ============================================================
