-- ============================================================
-- AlgoSphere Quant — Notification preferences + push subscriptions
-- Migration: 20240101000019_notifications.sql
-- ============================================================

-- Per-user channel preferences + routing rules
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id              UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Channel toggles
  telegram_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  -- Phone / WhatsApp numbers (E.164)
  whatsapp_number      TEXT,
  sms_number           TEXT,
  -- Per-event routing (JSONB map: event_type → channels[])
  -- e.g. { "new_signal": ["telegram","push"], "trial_expiring": ["email"] }
  routing_rules        JSONB NOT NULL DEFAULT '{}',
  -- Quiet hours
  quiet_hours_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_start          TIME NOT NULL DEFAULT '22:00',
  quiet_end            TIME NOT NULL DEFAULT '07:00',
  quiet_timezone       TEXT NOT NULL DEFAULT 'UTC',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_prefs_self"
  ON public.notification_preferences FOR ALL USING (user_id = auth.uid());

-- Web Push subscriptions (a user can have multiple — phone, laptop, tablet)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,           -- subscription.endpoint (unique per device/browser)
  p256dh_key   TEXT NOT NULL,           -- subscription.keys.p256dh
  auth_key     TEXT NOT NULL,           -- subscription.keys.auth
  user_agent   TEXT,                    -- nice-to-have for device label
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_subs_self"
  ON public.push_subscriptions FOR ALL USING (user_id = auth.uid());
CREATE POLICY "push_subs_service"
  ON public.push_subscriptions FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON public.push_subscriptions (user_id);

-- Notification delivery log (extends social_notifications with channel outcomes)
CREATE TABLE IF NOT EXISTS public.notification_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('telegram','email','push','whatsapp','sms')),
  event_type   TEXT NOT NULL,
  subject      TEXT,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('queued','sent','failed','bounced','read')),
  provider_ref TEXT,                    -- Resend ID / push endpoint hash etc
  error_msg    TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_log_self_read"
  ON public.notification_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notif_log_service_write"
  ON public.notification_log FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_notif_log_user
  ON public.notification_log (user_id, sent_at DESC);
