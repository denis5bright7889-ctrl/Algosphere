create table public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;
-- Only service role can insert/read leads
