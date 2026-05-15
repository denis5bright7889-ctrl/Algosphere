-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Demo / Sandbox Access Layer
-- Adds account_type so users can try Starter / Pro features with simulated data
-- without bypassing real subscription enforcement.
--
-- account_type values:
--   'live'           — default; real subscription tier is authoritative
--   'demo_starter'   — sandbox starter (simulated signals/journal/risk)
--   'demo_premium'   — sandbox pro (full UI on synthetic data)
--
-- Real subscription_tier remains 'free' for demo users — demo grants UI/feature
-- visibility only. Payment, live broker, and live execution are NEVER unlocked
-- by demo state.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists account_type        text   not null default 'live',
  add column if not exists demo_plan           text,
  add column if not exists demo_activated_at   timestamptz,
  add column if not exists demo_converted_at   timestamptz;

-- Enforce allowed values
alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('live', 'demo_starter', 'demo_premium'));

alter table public.profiles
  drop constraint if exists profiles_demo_plan_check;
alter table public.profiles
  add constraint profiles_demo_plan_check
  check (demo_plan is null or demo_plan in ('starter', 'premium'));

-- Index for fast filtering of demo users in admin analytics
create index if not exists idx_profiles_account_type
  on public.profiles(account_type)
  where account_type <> 'live';

comment on column public.profiles.account_type is
  'Account mode: live | demo_starter | demo_premium. Demo grants UI access only — no real entitlement.';
