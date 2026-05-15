-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Annual Billing (−20%)
-- Additive. Adds billing_interval to subscriptions + crypto_payments so a paid
-- period can be 1 month or 12 months. Existing rows default to 'monthly'.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists billing_interval text not null default 'monthly';

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_interval_check;
alter table public.subscriptions
  add constraint subscriptions_billing_interval_check
  check (billing_interval in ('monthly', 'annual'));

alter table public.crypto_payments
  add column if not exists billing_interval text not null default 'monthly';

alter table public.crypto_payments
  drop constraint if exists crypto_payments_billing_interval_check;
alter table public.crypto_payments
  add constraint crypto_payments_billing_interval_check
  check (billing_interval in ('monthly', 'annual'));
