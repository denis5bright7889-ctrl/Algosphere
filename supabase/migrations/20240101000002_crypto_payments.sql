-- =============================================================================
-- Crypto Payments — Binance USDT TRC20 manual verification flow
-- =============================================================================

create table public.crypto_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade not null,
  plan text not null check (plan in ('starter', 'premium')),
  amount_usd numeric not null,
  currency text not null default 'USDT',
  network text not null default 'TRC20',
  wallet_address text not null,
  txid text,
  screenshot_url text,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'pending_review', 'approved', 'rejected', 'expired')),
  admin_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),

  -- A TXID can only be used once across the entire system
  constraint crypto_payments_txid_unique unique (txid),
  -- A user cannot have two active/pending payments for the same plan
  constraint crypto_payments_one_pending_per_user_plan
    exclude using btree (user_id with =, plan with =)
    where (status in ('awaiting_payment', 'pending_review'))
);

create index on public.crypto_payments (user_id);
create index on public.crypto_payments (status);
create index on public.crypto_payments (txid) where txid is not null;

-- RLS
alter table public.crypto_payments enable row level security;

create policy "Users can view own payments"
  on public.crypto_payments for select
  using (auth.uid() = user_id);

create policy "Users can insert own payments"
  on public.crypto_payments for insert
  with check (auth.uid() = user_id);

create policy "Users can update own awaiting_payment rows (to submit proof)"
  on public.crypto_payments for update
  using (auth.uid() = user_id and status = 'awaiting_payment');

-- Service role can do everything (admin operations use service role)

-- Auto-expire payments older than 24h (run via pg_cron or handle in app)
create or replace function public.expire_old_crypto_payments()
returns void language plpgsql security definer as $$
begin
  update public.crypto_payments
  set status = 'expired'
  where status = 'awaiting_payment'
    and expires_at < now();
end;
$$;
