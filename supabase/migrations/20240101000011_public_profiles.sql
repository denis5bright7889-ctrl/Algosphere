-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Verified public trader profiles + leaderboard
--
-- Privacy model:
--   • Opt-in only. profiles.public_profile defaults FALSE.
--   • journal_entries RLS keeps raw trades private to the owner.
--   • Public aggregates are exposed ONLY through SECURITY DEFINER functions
--     that (a) include only opted-in users, (b) return aggregates — never
--     individual trades or PII beyond the chosen handle + bio.
--   • A Bayesian-shrunk win rate prevents a 1-trade 100% from topping the board.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists public_profile boolean not null default false,
  add column if not exists public_handle  text,
  add column if not exists bio            text;

create unique index if not exists idx_profiles_public_handle
  on public.profiles (lower(public_handle))
  where public_handle is not null;

-- ─── Leaderboard (top opted-in traders) ──────────────────────────────────────
-- score = win_rate% * shrink(trades), shrink = trades / (trades + 10)
-- → rewards consistency *with* volume; tiny samples are heavily discounted.
create or replace function public.trader_leaderboard(p_min_trades int default 5)
returns table (
  handle      text,
  bio         text,
  trades      bigint,
  wins        bigint,
  win_rate    numeric,
  total_pnl   numeric,
  avg_rr      numeric,
  score       numeric
)
language sql
security definer
set search_path = public
as $$
  select
    p.public_handle                                              as handle,
    p.bio                                                        as bio,
    count(j.*)                                                   as trades,
    count(*) filter (where coalesce(j.pnl,0) > 0)                as wins,
    round(100.0 * count(*) filter (where coalesce(j.pnl,0) > 0)
                 / nullif(count(j.*),0), 1)                      as win_rate,
    round(coalesce(sum(j.pnl),0), 2)                             as total_pnl,
    round(avg(nullif(j.risk_amount,0)), 2)                       as avg_rr,
    round(
      (100.0 * count(*) filter (where coalesce(j.pnl,0) > 0)
              / nullif(count(j.*),0))
      * (count(j.*)::numeric / (count(j.*) + 10)), 1)            as score
  from public.profiles p
  join public.journal_entries j on j.user_id = p.id
  where p.public_profile = true
    and p.public_handle is not null
  group by p.id, p.public_handle, p.bio
  having count(j.*) >= p_min_trades
  order by score desc, total_pnl desc
  limit 100;
$$;

-- ─── Single public profile by handle ─────────────────────────────────────────
create or replace function public.trader_profile(p_handle text)
returns table (
  handle      text,
  bio         text,
  member_since timestamptz,
  trades      bigint,
  wins        bigint,
  losses      bigint,
  win_rate    numeric,
  total_pnl   numeric,
  best_trade  numeric,
  worst_trade numeric
)
language sql
security definer
set search_path = public
as $$
  select
    p.public_handle,
    p.bio,
    p.created_at,
    count(j.*),
    count(*) filter (where coalesce(j.pnl,0) > 0),
    count(*) filter (where coalesce(j.pnl,0) < 0),
    round(100.0 * count(*) filter (where coalesce(j.pnl,0) > 0)
                 / nullif(count(j.*),0), 1),
    round(coalesce(sum(j.pnl),0), 2),
    round(coalesce(max(j.pnl),0), 2),
    round(coalesce(min(j.pnl),0), 2)
  from public.profiles p
  left join public.journal_entries j on j.user_id = p.id
  where p.public_profile = true
    and lower(p.public_handle) = lower(p_handle)
  group by p.id, p.public_handle, p.bio, p.created_at;
$$;

-- Read-only safe aggregates → expose to anonymous + authenticated visitors.
grant execute on function public.trader_leaderboard(int) to anon, authenticated;
grant execute on function public.trader_profile(text)     to anon, authenticated;
