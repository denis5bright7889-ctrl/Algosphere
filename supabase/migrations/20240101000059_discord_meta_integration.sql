-- 20240101000059_discord_meta_integration.sql
--
-- Discord + Meta (Facebook Page / Instagram / WhatsApp) integration
-- prep. Unblocks Slice 1 (Discord publisher) and Slice 2 (Meta Page +
-- Instagram poster) without dropping any feature code on the schema
-- yet. Idempotent — safe to re-run.
--
-- What this migration changes:
--
--   1. notification_log.channel CHECK is widened to allow 'discord'
--      so per-user Discord DM events (future feature) can log.
--
--   2. notification_preferences gets discord_enabled + discord_user_id
--      so users can opt in to per-user Discord notifications later
--      without another migration.
--
--   3. growth_scheduled_posts.channel CHECK is widened to allow
--      'facebook_page' / 'instagram_post' / 'instagram_story' /
--      'whatsapp_broadcast' / 'discord_announcement'. Today the
--      growth scheduler only handles WhatsApp Channel / IG Reels /
--      YT Shorts; the rebuilt social distribution layer covers the
--      full Meta + Discord surface.
--
--   4. NEW system_event_log — non-user-scoped broadcast event log.
--      Records "signal generated / rejected / trade open / SL hit /
--      breaker open / health alert" events as they fire to a Discord
--      channel webhook. Different from notification_log (which is
--      per-user); this one is per-channel-broadcast.
--
--   5. NEW meta_connected_accounts — admin-visible metadata about
--      which FB Page / IG Business / WhatsApp account is connected.
--      NEVER stores tokens; those live in Vercel env vars. Just the
--      display name + external ID so the /admin/social page can
--      render "Posting as @algospherequant" without needing the
--      token to fetch it.
--
-- RLS: every new table and policy is admin/service-only. Regular
-- users cannot read system_event_log or meta_connected_accounts.

-- ── 1. notification_log.channel — accept 'discord' ─────────────────
ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_channel_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_channel_check
  CHECK (channel IN ('telegram','email','push','whatsapp','sms','discord'));


-- ── 2. notification_preferences — Discord opt-in ──────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS discord_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discord_user_id TEXT;
COMMENT ON COLUMN public.notification_preferences.discord_user_id IS
  'Discord snowflake user ID for per-user DMs. Optional; broadcast '
  'channels do not require it.';


-- ── 3. growth_scheduled_posts.channel — widen to Meta + Discord ───
ALTER TABLE public.growth_scheduled_posts
  DROP CONSTRAINT IF EXISTS growth_scheduled_posts_channel_check;
ALTER TABLE public.growth_scheduled_posts
  ADD CONSTRAINT growth_scheduled_posts_channel_check
  CHECK (channel IN (
    -- WhatsApp surfaces
    'whatsapp_channel',
    'whatsapp_broadcast',
    -- Meta — Instagram
    'instagram_reels',
    'instagram_post',
    'instagram_story',
    -- Meta — Facebook
    'facebook_page',
    'facebook_story',
    -- YouTube
    'youtube_shorts',
    -- Discord (long-form announcements; transient signal events go
    -- through system_event_log, not the scheduler)
    'discord_announcement'
  ));


-- ── 4. system_event_log — non-user broadcast events ───────────────
CREATE TABLE IF NOT EXISTS public.system_event_log (
  id              BIGSERIAL PRIMARY KEY,
  surface         TEXT NOT NULL CHECK (surface IN (
                    'signal_generated',
                    'signal_rejected',
                    'trade_open',
                    'trade_close',
                    'sl_hit',
                    'tp_hit',
                    'risk_locked',
                    'breaker_open',
                    'health_alert',
                    'mt5_status'
                  )),
  payload_summary JSONB NOT NULL,        -- sanitized snapshot (no PII)
  channel         TEXT NOT NULL,         -- e.g. 'discord_signals_free'
  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','failed','skipped')),
  status_code     INTEGER,
  error_class     TEXT,                  -- sanitized: 'rate_limit'/'auth_failure'/etc
  reference_id    UUID,                  -- FK shape only (signal/trade row)
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_event_log_admin_read"
  ON public.system_event_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND account_type = 'admin'
    )
  );
CREATE POLICY "system_event_log_service_write"
  ON public.system_event_log FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_system_event_log_surface_sent
  ON public.system_event_log (surface, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_log_channel_sent
  ON public.system_event_log (channel, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_log_failures
  ON public.system_event_log (sent_at DESC)
  WHERE status = 'failed';


-- ── 5. meta_connected_accounts — admin-visible account metadata ───
-- NEVER stores tokens. Tokens live in Vercel env vars only. This
-- table is purely so the /admin/social page can render "Posting as
-- @algospherequant on Page + IG Business" without us needing the
-- token to fetch it.
CREATE TABLE IF NOT EXISTS public.meta_connected_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface         TEXT NOT NULL CHECK (surface IN (
                    'facebook_page',
                    'instagram_business',
                    'whatsapp_business'
                  )),
  external_id     TEXT NOT NULL,           -- FB page_id / IG business id / WA phone id
  display_name    TEXT NOT NULL,           -- @algospherequant / AlgoSphere Quant
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_post_at    TIMESTAMPTZ,
  UNIQUE (surface, external_id)
);

ALTER TABLE public.meta_connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_accounts_admin_read"
  ON public.meta_connected_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND account_type = 'admin'
    )
  );
CREATE POLICY "meta_accounts_service_write"
  ON public.meta_connected_accounts FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_meta_accounts_active
  ON public.meta_connected_accounts (surface, active)
  WHERE active = TRUE;
