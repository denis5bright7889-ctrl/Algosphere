-- =============================================================================
-- AI Trading Hub — Initial Schema
-- =============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  telegram_chat_id bigint unique,
  whatsapp_number text,
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'starter', 'premium')),
  subscription_status text
    check (subscription_status in ('trialing', 'active', 'canceled', 'past_due')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade not null,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('starter', 'premium')),
  status text not null check (status in ('trialing', 'active', 'canceled', 'past_due')),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- signals
-- ---------------------------------------------------------------------------
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  pair text not null,
  direction text not null check (direction in ('buy', 'sell')),
  entry_price numeric,
  stop_loss numeric,
  take_profit_1 numeric,
  take_profit_2 numeric,
  take_profit_3 numeric,
  risk_reward numeric,
  status text not null default 'active'
    check (status in ('active', 'closed', 'cancelled')),
  result text check (result in ('win', 'loss', 'breakeven')),
  pips_gained numeric,
  tier_required text not null default 'starter'
    check (tier_required in ('free', 'starter', 'premium')),
  published_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

alter table public.signals enable row level security;

-- Authenticated users can read signals if their tier >= tier_required
create policy "Users can read signals matching their tier"
  on public.signals for select
  to authenticated
  using (
    case tier_required
      when 'free'    then true
      when 'starter' then (
        select subscription_tier in ('starter', 'premium')
        from public.profiles where id = auth.uid()
      )
      when 'premium' then (
        select subscription_tier = 'premium'
        from public.profiles where id = auth.uid()
      )
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade not null,
  pair text,
  direction text check (direction in ('buy', 'sell')),
  entry_price numeric,
  exit_price numeric,
  lot_size numeric,
  pips numeric,
  pnl numeric,
  risk_amount numeric,
  setup_tag text,
  notes text,
  screenshot_url text,
  trade_date date,
  created_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

create policy "Users can manage own journal entries"
  on public.journal_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- referrals
-- ---------------------------------------------------------------------------
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references public.profiles (id) on delete cascade not null,
  referred_id uuid references public.profiles (id) on delete cascade not null,
  commission_pct numeric not null default 20,
  commission_paid boolean not null default false,
  created_at timestamptz not null default now(),
  unique (referrer_id, referred_id)
);

alter table public.referrals enable row level security;

create policy "Users can view own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id);
