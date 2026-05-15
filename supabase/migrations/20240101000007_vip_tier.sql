-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — VIP tier ($299/month) + demo_vip
-- Adds 'vip' to allowed subscription_tier and subscriptions.plan values,
-- and 'demo_vip' to profiles.account_type. Existing rows are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- Extend profiles.account_type to allow demo_vip
alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('live', 'demo_starter', 'demo_premium', 'demo_vip'));

-- Some installations enforce subscription_tier values via CHECK; reset to
-- the new allowed set. Safe if no prior constraint exists.
alter table public.profiles
  drop constraint if exists profiles_subscription_tier_check;
alter table public.profiles
  add constraint profiles_subscription_tier_check
  check (subscription_tier in ('free', 'starter', 'premium', 'vip'));

-- Same for the subscriptions table
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('starter', 'premium', 'vip'));

-- Same for crypto_payments
alter table public.crypto_payments
  drop constraint if exists crypto_payments_plan_check;
alter table public.crypto_payments
  add constraint crypto_payments_plan_check
  check (plan in ('starter', 'premium', 'vip'));

-- Same for signals.tier_required (so VIP-tier signals are queryable)
alter table public.signals
  drop constraint if exists signals_tier_required_check;
alter table public.signals
  add constraint signals_tier_required_check
  check (tier_required in ('free', 'starter', 'premium', 'vip'));
