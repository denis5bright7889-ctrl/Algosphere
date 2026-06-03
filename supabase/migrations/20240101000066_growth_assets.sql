-- 20240101000066_growth_assets.sql
--
-- Asset production pipeline — extends growth_content_items so the
-- Railway asset-worker can pick up rows that need visual assets
-- (screenshots, image cards, infographics, videos, PDFs, carousels),
-- produce them out-of-band, and attach the URLs back to the row
-- before the publisher fans out.
--
-- Flow:
--   1. /api/automation/events matches a rule → creates content_item
--      with asset_state='pending' and asset_kinds=['signal_chart',
--      'signal_card'] (per the founder's asset matrix).
--   2. Railway asset-worker polls WHERE asset_state='pending'
--      AND scheduled_for IS NULL OR scheduled_for - 30min < now()
--      so assets land in time for the schedule.
--   3. Worker produces each kind, uploads to growth-assets bucket,
--      writes URLs into asset_urls (kind → public URL), flips
--      asset_state to 'ready'.
--   4. Scheduler skips content_items WHERE asset_state IN
--      ('pending','producing') so a half-produced row never goes
--      out half-baked. On 'ready' it pulls hero_image_url from
--      asset_urls.hero (or a kind-specific key per channel adapter).
--   5. asset_state='failed' surfaces in /admin/growth so the
--      operator sees what didn't produce and why.
--
-- Idempotent.

-- ── 1. State machine column ───────────────────────────────────────
ALTER TABLE public.growth_content_items
  ADD COLUMN IF NOT EXISTS asset_state TEXT NOT NULL DEFAULT 'none'
    CHECK (asset_state IN ('none','pending','producing','ready','failed','partial')),
  -- Comma-list of asset kinds the worker should produce for this row.
  -- Free-form text array — new producer types can be added in the
  -- worker without a migration. Empty array + asset_state='ready'
  -- means "no assets needed, publish text-only".
  ADD COLUMN IF NOT EXISTS asset_kinds TEXT[] NOT NULL DEFAULT '{}',
  -- kind → URL map. e.g. {"signal_card": "https://...", "chart": "..."}.
  -- Pulled by the channel adapter when shaping the payload (FB feed
  -- needs hero, IG needs square, carousel uses an array).
  ADD COLUMN IF NOT EXISTS asset_urls JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Producer error per kind. {"signal_card": "rate_limited", ...}
  ADD COLUMN IF NOT EXISTS asset_errors JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Worker lease — set when a worker begins producing so a second
  -- worker doesn't race it. Cleared when 'ready' / 'failed'. 5-min
  -- TTL: a crashed worker's lease auto-expires.
  ADD COLUMN IF NOT EXISTS asset_worker_lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_growth_content_asset_state
  ON public.growth_content_items (asset_state, scheduled_for)
  WHERE asset_state IN ('pending','producing');


-- ── 2. Worker activity log ────────────────────────────────────────
-- Append-only audit of every asset production attempt. Mirrors the
-- pattern of growth_post_attempts. Operator-readable from
-- /admin/growth so they see "signal_card took 2.3s, ok".

CREATE TABLE IF NOT EXISTS public.growth_asset_attempts (
  id              BIGSERIAL PRIMARY KEY,
  content_item_id UUID NOT NULL REFERENCES public.growth_content_items(id) ON DELETE CASCADE,
  asset_kind      TEXT NOT NULL,
  ok              BOOLEAN NOT NULL,
  url             TEXT,                  -- uploaded asset URL when ok
  storage_path    TEXT,                  -- bucket path (debugging)
  bytes           BIGINT,
  duration_ms     INTEGER,
  error           TEXT,
  worker_id       TEXT,                  -- Railway instance hint
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_asset_attempts_content
  ON public.growth_asset_attempts (content_item_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_asset_attempts_failures
  ON public.growth_asset_attempts (attempted_at DESC)
  WHERE ok = FALSE;

ALTER TABLE public.growth_asset_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "growth_assets_admin_read"
  ON public.growth_asset_attempts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND account_type = 'admin'
  ));
CREATE POLICY "growth_assets_service_write"
  ON public.growth_asset_attempts FOR ALL
  USING (auth.role() = 'service_role');


-- ── 3. Mirror failed/ready transitions to system_event_log ────────
-- Same observability pattern as 20240101000065 (the publish mirror).
-- Operator sees asset production events alongside engine + risk
-- events in the unified ops view.

ALTER TABLE public.system_event_log
  DROP CONSTRAINT IF EXISTS system_event_log_surface_check;
ALTER TABLE public.system_event_log
  ADD CONSTRAINT system_event_log_surface_check
  CHECK (surface IN (
    -- Signal lifecycle (existing)
    'signal_generated', 'signal_skipped', 'signal_rejected', 'signal_drought',
    -- Trade lifecycle (existing)
    'trade_sent', 'trade_open', 'trade_failed', 'trade_close', 'sl_hit', 'tp_hit',
    -- Risk (existing)
    'risk_block', 'risk_locked', 'breaker_open',
    -- System / health (existing)
    'health_alert', 'mt5_status', 'data_drought',
    'regime_classification', 'engine_event',
    -- Growth publish lifecycle (existing from 65)
    'growth_publish_attempt', 'growth_publish_failed',
    'growth_publish_ok', 'growth_smoke_test',
    -- NEW: Asset production lifecycle
    'growth_asset_attempt',
    'growth_asset_ok',
    'growth_asset_failed'
  ));


CREATE OR REPLACE FUNCTION public.mirror_growth_asset_to_event_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_surface TEXT;
BEGIN
  BEGIN
    v_surface := CASE WHEN NEW.ok THEN 'growth_asset_ok' ELSE 'growth_asset_failed' END;
    INSERT INTO public.system_event_log (
      surface, channel, payload_summary, reference_id,
      status, error_class
    ) VALUES (
      v_surface, 'internal',
      jsonb_build_object(
        'attempt_id',      NEW.id,
        'asset_kind',      NEW.asset_kind,
        'duration_ms',     NEW.duration_ms,
        'bytes',           NEW.bytes,
        'worker_id',       NEW.worker_id
      ),
      NEW.content_item_id,
      CASE WHEN NEW.ok THEN 'sent' ELSE 'failed' END,
      CASE WHEN NEW.ok THEN NULL ELSE 'asset_production' END
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_asset_mirror ON public.growth_asset_attempts;
CREATE TRIGGER trg_growth_asset_mirror
  AFTER INSERT ON public.growth_asset_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_growth_asset_to_event_log();
