-- =============================================================================
-- AlgoSphere Signal Engine — ADDITIVE migration only
-- Uses IF NOT EXISTS / safe extensions throughout
-- =============================================================================

-- ---------------------------------------------------------------------------
-- signal_feedback — user/system feedback on signal outcomes
-- ---------------------------------------------------------------------------
create table if not exists public.signal_feedback (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade,
  source text not null default 'system'  -- 'system' | 'user' | 'admin'
    check (source in ('system','user','admin')),
  outcome text check (outcome in ('win','loss','breakeven','missed')),
  actual_pips numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_signal_feedback_signal on public.signal_feedback (signal_id);
create index if not exists idx_signal_feedback_user on public.signal_feedback (user_id) where user_id is not null;

alter table if exists public.signal_feedback enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'signal_feedback' and policyname = 'Users can view own feedback'
  ) then
    create policy "Users can view own feedback"
      on public.signal_feedback for select using (auth.uid() = user_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- signal_analytics — per-signal confidence calibration
-- ---------------------------------------------------------------------------
create table if not exists public.signal_analytics (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete cascade not null unique,
  confidence_bucket integer,            -- 40,50,60,70,80,90 (lower bound)
  was_correct boolean,
  exit_pips numeric,
  duration_minutes integer,
  regime_at_entry text,
  session_at_entry text,
  spread_at_entry numeric,
  mae_pips numeric,                     -- Max Adverse Excursion
  mfe_pips numeric,                     -- Max Favorable Excursion
  computed_at timestamptz not null default now()
);

create index if not exists idx_signal_analytics_bucket on public.signal_analytics (confidence_bucket);
create index if not exists idx_signal_analytics_regime on public.signal_analytics (regime_at_entry);
create index if not exists idx_signal_analytics_session on public.signal_analytics (session_at_entry);

alter table if exists public.signal_analytics enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'signal_analytics' and policyname = 'Authenticated read signal analytics'
  ) then
    create policy "Authenticated read signal analytics"
      on public.signal_analytics for select to authenticated using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- regime_snapshots — market regime log per symbol per scan
-- ---------------------------------------------------------------------------
create table if not exists public.regime_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  timeframe text not null,
  regime text not null,
  der_score numeric,          -- Directional Efficiency Ratio
  entropy_score numeric,      -- Shannon entropy
  autocorr_score numeric,     -- Autocorrelation
  atr_pct numeric,
  adx_value numeric,
  session text,
  scanned_at timestamptz not null default now()
);

create index if not exists idx_regime_snapshots_symbol on public.regime_snapshots (symbol, scanned_at desc);
create index if not exists idx_regime_snapshots_regime on public.regime_snapshots (regime, scanned_at desc);

alter table if exists public.regime_snapshots enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'regime_snapshots' and policyname = 'Authenticated read regimes'
  ) then
    create policy "Authenticated read regimes"
      on public.regime_snapshots for select to authenticated using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- engine_circuit_breaker — risk state tracking
-- ---------------------------------------------------------------------------
create table if not exists public.engine_circuit_breaker (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  is_open boolean not null default false,    -- true = no new signals
  reason text,
  consecutive_losses integer default 0,
  daily_loss_count integer default 0,
  last_loss_at timestamptz,
  opens_at timestamptz,
  resets_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table if exists public.engine_circuit_breaker enable row level security;

-- ---------------------------------------------------------------------------
-- Extend signals table safely (nullable additions only)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='signals' and column_name='engine_version') then
    alter table public.signals add column engine_version text default 'manual';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='signals' and column_name='der_score') then
    alter table public.signals add column der_score numeric;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='signals' and column_name='entropy_score') then
    alter table public.signals add column entropy_score numeric;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='signals' and column_name='feature_snapshot') then
    alter table public.signals add column feature_snapshot jsonb;
  end if;
end $$;
