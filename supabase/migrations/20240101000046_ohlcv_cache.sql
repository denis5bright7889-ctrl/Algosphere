-- Persistent OHLCV cache (L1) — survives engine deploys.
--
-- The engine's in-memory OHLCV cache is wiped on every container restart.
-- When TwelveData's daily quota is exhausted, a freshly-restarted engine
-- has no last-good bars to fall back on, so FX/metals return
-- "Insufficient bars (0)" until the quota resets — a partial-universe
-- (crypto-biased) outage. This table is the durable backing: last-known
-- candles per (symbol, interval), read on cold start and served when every
-- live provider is empty.
--
-- Security: RLS enabled with NO policy → service-role only (the engine
-- worker). Never read or written by a user/client. Same pattern as the
-- other engine-owned tables (regime_snapshots, intel_decisions, …).
--
-- Honesty: stores ONLY real candles returned by a provider. It never
-- fabricates bars; it only preserves the last real ones across restarts.

create table if not exists public.ohlcv_cache (
  symbol         text not null,
  interval       text not null,
  bars           jsonb not null,             -- ASC array of {t,o,h,l,c,v}
  bar_count      int  not null default 0,
  last_candle_ts text,                       -- timestamp of the newest bar
  provider       text,                       -- which provider last filled it
  updated_at     timestamptz not null default now(),
  primary key (symbol, interval)
);

create index if not exists ohlcv_cache_updated_at
  on public.ohlcv_cache (updated_at desc);

alter table public.ohlcv_cache enable row level security;
-- No policies on purpose → only the service role (engine) can touch it.

comment on table public.ohlcv_cache is
  'Persistent OHLCV L1 cache — last-known real candles per (symbol, interval). Engine service-role only. Lets the cache survive deploys + provider quota exhaustion so the universe never cold-starts into partial blindness.';
