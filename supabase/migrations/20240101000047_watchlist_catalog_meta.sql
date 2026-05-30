-- watchlist_items: optional metadata for symbols pinned from the
-- Twelve Data catalog browser (i.e. symbols that are NOT in the
-- hardcoded MARKET_UNIVERSE). Universe-pinned rows leave these NULL
-- and continue resolving metadata via the local catalog.
--
-- Idempotent (uses IF NOT EXISTS) so a partial-applied state on any
-- environment is safe to re-run.

ALTER TABLE public.watchlist_items
  ADD COLUMN IF NOT EXISTS provider        TEXT,
  ADD COLUMN IF NOT EXISTS provider_symbol TEXT,
  ADD COLUMN IF NOT EXISTS label           TEXT;

-- Cheap CHECK: when metadata IS set, the provider must be one we
-- know how to quote against. Universe pins (NULL provider) are
-- untouched. Drop+recreate keeps re-runs idempotent.
ALTER TABLE public.watchlist_items
  DROP CONSTRAINT IF EXISTS watchlist_items_provider_check;
ALTER TABLE public.watchlist_items
  ADD  CONSTRAINT watchlist_items_provider_check
       CHECK (provider IS NULL OR provider IN ('twelvedata','finnhub','crypto-stream'));
