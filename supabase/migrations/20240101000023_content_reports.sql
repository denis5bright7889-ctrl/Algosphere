-- ============================================================
-- AlgoSphere Quant — Content reports (community moderation)
-- Migration: 20240101000023_content_reports.sql
--
-- A single reports table covers every reportable surface
-- (social_posts, discussion_replies, social_comments…). Polymorphic
-- via target_type + target_id (uuid). Uniqueness on
-- (reporter, target_type, target_id) prevents brigading from one
-- account.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.content_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL
                 CHECK (target_type IN ('social_post','discussion_reply','signal','comment','profile')),
  target_id    UUID NOT NULL,
  reason       TEXT NOT NULL
                 CHECK (reason IN ('spam','harassment','misleading','illegal','other')),
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','dismissed','actioned')),
  resolved_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One report per (reporter, target) — re-reporting same item is a no-op
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_pending
  ON public.content_reports (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON public.content_reports (target_type, target_id);

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Reporters can insert + see their own
CREATE POLICY "reports_self_insert"
  ON public.content_reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports_self_read"
  ON public.content_reports FOR SELECT USING (reporter_id = auth.uid());

-- Service role (admin endpoints) bypasses
CREATE POLICY "reports_service"
  ON public.content_reports FOR ALL USING (auth.role() = 'service_role');
