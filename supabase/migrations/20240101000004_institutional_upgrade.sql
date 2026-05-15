-- =============================================================================
-- AlgoSphere Quant — Institutional Platform Upgrade
-- Signal lifecycle, strategy attribution, quality scoring, API keys,
-- execution telemetry, audit logging, materialized analytics
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STRATEGY REGISTRY
-- ---------------------------------------------------------------------------
create table public.strategy_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                   -- 'trend_continuation', 'breakout_retest', etc.
  display_name text not null,
  description text,
  timeframes text[] default '{}',              -- ['H1', 'H4', 'D1']
  instruments text[] default '{}',             -- ['XAUUSD', 'EURUSD']
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.strategy_registry (name, display_name, description, timeframes) values
  ('trend_continuation', 'Trend Continuation', 'EMA pullback entries in established trends', array['H1','H4']),
  ('breakout_retest',    'Breakout + Retest',  'Structure breakout with confirmed retest', array['H1','H4','D1']),
  ('reversal_structure', 'Reversal at Structure', 'HTF S/R reversal with LTF confirmation', array['M15','H1']),
  ('momentum_scalp',     'Momentum Scalp',     'RSI extreme + momentum reversal', array['M5','M15']),
  ('order_block',        'Order Block',        'ICT order block mitigation entry', array['H1','H4']),
  ('fair_value_gap',     'Fair Value Gap',     'FVG fill with trend alignment', array['M15','H1']);

-- ---------------------------------------------------------------------------
-- SIGNAL LIFECYCLE UPGRADE — extend existing signals table
-- ---------------------------------------------------------------------------
alter table public.signals
  add column if not exists lifecycle_state text not null default 'queued'
    check (lifecycle_state in ('pending','queued','active','tp1_hit','tp2_hit','tp3_hit',
                                'stopped','invalidated','expired','breakeven')),
  add column if not exists strategy_id uuid references public.strategy_registry(id),
  add column if not exists confidence_score integer check (confidence_score between 0 and 100),
  add column if not exists quality_score numeric(4,2) check (quality_score between 0 and 10),
  add column if not exists regime text
    check (regime in ('trending','ranging','volatile','dead','breakout','compression')),
  add column if not exists session text
    check (session in ('asian','london','new_york','london_ny','off_hours')),
  add column if not exists trend_score integer,
  add column if not exists momentum_score integer,
  add column if not exists liquidity_score integer,
  add column if not exists rr_score integer,
  add column if not exists volatility_score integer,
  add column if not exists tp1_hit_at timestamptz,
  add column if not exists tp2_hit_at timestamptz,
  add column if not exists tp3_hit_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists invalidated_at timestamptz,
  add column if not exists max_adverse_excursion numeric,  -- MAE: worst pip move against trade
  add column if not exists max_favorable_excursion numeric, -- MFE: best pip move in trade direction
  add column if not exists admin_notes text,
  add column if not exists tags text[] default '{}';

-- ---------------------------------------------------------------------------
-- EXECUTION LOGS (MT5 bridge preparation)
-- ---------------------------------------------------------------------------
create table public.execution_logs (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete set null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  order_type text not null check (order_type in ('market','limit','stop')),
  direction text not null check (direction in ('buy','sell')),
  symbol text not null,
  requested_price numeric not null,
  fill_price numeric,
  requested_lots numeric not null,
  filled_lots numeric,
  slippage_pips numeric,
  spread_at_entry numeric,
  status text not null default 'pending'
    check (status in ('pending','filled','partial','rejected','cancelled','timeout')),
  rejection_reason text,
  broker_ticket_id text,
  broker_name text,
  latency_ms integer,
  mt5_account text,
  requested_at timestamptz not null default now(),
  filled_at timestamptz,
  closed_at timestamptz,
  close_price numeric,
  realized_pnl numeric,
  realized_pips numeric
);

create index on public.execution_logs (user_id);
create index on public.execution_logs (signal_id) where signal_id is not null;
create index on public.execution_logs (status);
create index on public.execution_logs (requested_at desc);

alter table public.execution_logs enable row level security;
create policy "Users can view own execution logs"
  on public.execution_logs for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- API KEYS (white-label + $99 tier public API)
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  key_prefix text not null,                 -- first 8 chars visible: 'aq_live_'
  key_hash text not null unique,             -- SHA-256 of full key, never store raw
  permissions text[] not null default array['signals:read'],
  rate_limit_per_minute integer not null default 60,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.api_keys (user_id);
create index on public.api_keys (key_hash);

alter table public.api_keys enable row level security;
create policy "Users can manage own API keys"
  on public.api_keys for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- AUDIT LOGS (admin operations)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  action text not null,          -- 'signal.create', 'payment.approve', 'user.tier_change'
  resource_type text not null,   -- 'signal', 'payment', 'profile', 'api_key'
  resource_id text,
  before_state jsonb,
  after_state jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index on public.audit_logs (actor_id);
create index on public.audit_logs (action);
create index on public.audit_logs (resource_type, resource_id);
create index on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;
-- Only service role writes audit logs; admins read via API

-- ---------------------------------------------------------------------------
-- STRATEGY PERFORMANCE VIEW (replaces query-time aggregation)
-- ---------------------------------------------------------------------------
create or replace view public.strategy_performance as
select
  sr.id as strategy_id,
  sr.name,
  sr.display_name,
  count(s.id) as total_signals,
  count(s.id) filter (where s.status = 'closed') as closed_signals,
  count(s.id) filter (where s.result = 'win') as wins,
  count(s.id) filter (where s.result = 'loss') as losses,
  count(s.id) filter (where s.result = 'breakeven') as breakevens,
  case
    when count(s.id) filter (where s.status = 'closed') = 0 then 0
    else round(
      count(s.id) filter (where s.result = 'win')::numeric
      / count(s.id) filter (where s.status = 'closed') * 100, 1
    )
  end as win_rate_pct,
  avg(s.quality_score) as avg_quality_score,
  avg(s.confidence_score) as avg_confidence,
  avg(s.pips_gained) filter (where s.result = 'win') as avg_win_pips,
  avg(s.pips_gained) filter (where s.result = 'loss') as avg_loss_pips,
  avg(s.risk_reward) as avg_rr
from public.strategy_registry sr
left join public.signals s on s.strategy_id = sr.id
group by sr.id, sr.name, sr.display_name;

-- ---------------------------------------------------------------------------
-- SIGNAL LIFECYCLE INDEXES
-- ---------------------------------------------------------------------------
create index if not exists idx_signals_lifecycle on public.signals (lifecycle_state);
create index if not exists idx_signals_strategy on public.signals (strategy_id) where strategy_id is not null;
create index if not exists idx_signals_regime on public.signals (regime) where regime is not null;
create index if not exists idx_signals_confidence on public.signals (confidence_score desc) where confidence_score is not null;
create index if not exists idx_signals_quality on public.signals (quality_score desc) where quality_score is not null;

-- ---------------------------------------------------------------------------
-- ANALYTICS SNAPSHOT TABLE (background aggregation cache)
-- ---------------------------------------------------------------------------
create table public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_type text not null,    -- 'daily_platform', 'weekly_strategy', 'monthly_revenue'
  snapshot_date date not null,
  data jsonb not null,
  computed_at timestamptz not null default now(),
  unique (snapshot_type, snapshot_date)
);

create index on public.analytics_snapshots (snapshot_type, snapshot_date desc);
