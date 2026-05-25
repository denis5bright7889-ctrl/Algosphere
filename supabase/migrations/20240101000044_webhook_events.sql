-- 20240101000044_webhook_events.sql
--
-- Durable sink + idempotency store for inbound provider webhooks
-- (Finnhub and friends), written by the signal-engine's
-- /api/v1/webhooks/{provider} endpoint. Raw payloads are kept verbatim so
-- a downstream consumer can route news/earnings/etc. without re-fetching.

CREATE TABLE IF NOT EXISTS webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,            -- finnhub, twelvedata, …
  event_type    text,                     -- news | earnings | … (provider-specific)
  external_id   text,                     -- provider's event id, for dedup
  symbol        text,
  payload       jsonb NOT NULL,
  signature_ok  boolean NOT NULL DEFAULT true,
  processed     boolean NOT NULL DEFAULT false,
  received_at   timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: the same (provider, external_id) can't be stored twice.
-- Partial so events without an id (some providers omit one) aren't blocked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_provider_extid
  ON webhook_events(provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_received
  ON webhook_events(provider, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON webhook_events(received_at) WHERE processed = false;

-- RLS on, no policies → service-role only (the engine). No user/anon access
-- to raw provider payloads.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE webhook_events IS
  'Inbound provider-webhook events (Finnhub/etc). Service-role only. Unique on (provider, external_id) for idempotent retries.';
