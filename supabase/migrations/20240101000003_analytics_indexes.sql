-- =============================================================================
-- Analytics performance indexes
-- =============================================================================

-- profiles: fast tier lookups + signup chart
create index if not exists idx_profiles_subscription_tier on public.profiles (subscription_tier);
create index if not exists idx_profiles_subscription_status on public.profiles (subscription_status);
create index if not exists idx_profiles_created_at on public.profiles (created_at desc);

-- signals: active feed + analytics
create index if not exists idx_signals_status on public.signals (status);
create index if not exists idx_signals_published_at on public.signals (published_at desc);
create index if not exists idx_signals_pair on public.signals (pair);
create index if not exists idx_signals_result on public.signals (result) where result is not null;

-- journal_entries: per-user analytics + P&L aggregation
create index if not exists idx_journal_user_id on public.journal_entries (user_id);
create index if not exists idx_journal_trade_date on public.journal_entries (trade_date desc);
create index if not exists idx_journal_pair on public.journal_entries (pair);
create index if not exists idx_journal_setup_tag on public.journal_entries (setup_tag) where setup_tag is not null;

-- crypto_payments: payment dashboard
create index if not exists idx_crypto_payments_status on public.crypto_payments (status);
create index if not exists idx_crypto_payments_user_id on public.crypto_payments (user_id);
create index if not exists idx_crypto_payments_reviewed_at on public.crypto_payments (reviewed_at desc) where reviewed_at is not null;
