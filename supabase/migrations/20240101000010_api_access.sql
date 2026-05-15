-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Public API access: metering + rate limiting
-- Additive. api_keys table already exists (institutional_upgrade migration).
-- Adds lifetime metering on the key + a per-minute usage window table that
-- the auth layer upserts atomically to enforce rate_limit_per_minute.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.api_keys
  add column if not exists total_requests bigint not null default 0;

-- Per-minute sliding bucket. One row per (key, minute). The auth layer does
-- an atomic upsert-increment and compares count to the key's rate limit.
create table if not exists public.api_usage (
  api_key_id   uuid not null references public.api_keys(id) on delete cascade,
  window_start timestamptz not null,           -- truncated to the minute
  count        integer not null default 0,
  primary key (api_key_id, window_start)
);

create index if not exists idx_api_usage_window
  on public.api_usage (window_start);

-- api_usage is written exclusively by the service role (the API auth layer).
-- Enable RLS with no policies → only service role can touch it.
alter table public.api_usage enable row level security;

-- Atomic increment helper: bumps the minute bucket and returns the new count.
-- SECURITY DEFINER so the service role call is self-contained.
create or replace function public.bump_api_usage(p_key_id uuid, p_window timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.api_usage (api_key_id, window_start, count)
  values (p_key_id, p_window, 1)
  on conflict (api_key_id, window_start)
  do update set count = public.api_usage.count + 1
  returning count into v_count;

  update public.api_keys
    set total_requests = total_requests + 1,
        last_used_at   = now()
    where id = p_key_id;

  return v_count;
end;
$$;
