-- Adaptive Intelligence — Phase A: decision log.
--
-- Append-only record of the opinions the Intelligence engines ship
-- (Conviction / Stress / Smart Money to start). This is the substrate
-- the Meta-Intelligence + Strategy-Evolution phases will later learn
-- from (see docs/architecture/adaptive-intelligence.md). Phase A only
-- RECORDS — it makes no claims and changes no behaviour.
--
-- Dedup model: each engine writes at most one row per
-- (surface, symbol, fingerprint, 15-min bucket). The fingerprint is a
-- compact hash of the salient state, so an unchanged read inside a
-- bucket collides on the unique index and the insert is a no-op
-- (ON CONFLICT DO NOTHING). This bounds write volume even though the
-- composers run on every server render.
--
-- Security: RLS enabled with NO policy → service-role only, consistent
-- with the other engine-owned tables. No user ever reads/writes this
-- directly; the outcome-resolution + meta jobs (Phase B) use the
-- service role.

create table if not exists public.intel_decisions (
  id            uuid primary key default gen_random_uuid(),
  surface       text        not null,             -- 'conviction' | 'stress' | 'smart-money' | …
  symbol        text        not null default '',  -- '' for universe-level surfaces
  fingerprint   text        not null,             -- compact hash of the salient state
  payload       jsonb       not null,             -- the engineered view at decision time
  bucket        timestamptz not null,             -- 15-min-truncated time bucket (dedup)
  generated_at  timestamptz not null default now()
);

-- One decision per (surface, symbol, fingerprint, bucket). Plain columns
-- (symbol defaulted to '' not null) so ON CONFLICT can target them.
create unique index if not exists intel_decisions_dedup
  on public.intel_decisions (surface, symbol, fingerprint, bucket);

-- Recall / outcome-resolution access patterns (Phase B): by surface+symbol
-- over time, and by recency.
create index if not exists intel_decisions_surface_symbol_time
  on public.intel_decisions (surface, symbol, generated_at desc);

alter table public.intel_decisions enable row level security;
-- No policies on purpose → only the service role can touch it.

comment on table public.intel_decisions is
  'Adaptive Intelligence Phase A — append-only log of Intelligence-engine opinions. Service-role only. See docs/architecture/adaptive-intelligence.md.';
