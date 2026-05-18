-- Watchlist items.
--
-- Each row is a user's pinned symbol from the canonical Market
-- Universe (lib/market-universe.ts). No price data is stored here —
-- pricing is computed at read time from whichever feed is wired for
-- that asset class. asset_class is captured at insert time so the UI
-- can group/style without a join.

CREATE TABLE IF NOT EXISTS public.watchlist_items (
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (
    asset_class IN ('forex','indices','commodities','futures','stocks','crypto')
  ),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user
  ON public.watchlist_items(user_id, added_at DESC);

ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_own_select"
  ON public.watchlist_items
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "watchlist_own_insert"
  ON public.watchlist_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_own_delete"
  ON public.watchlist_items
  FOR DELETE
  USING (auth.uid() = user_id);
