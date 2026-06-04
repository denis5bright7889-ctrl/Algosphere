-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Psychology Leaderboard consent + opt-in (Psychology V3 / Phase 3)
--
-- Adds explicit, opt-in consent for the PUBLIC psychology rankings. This is a
-- DISTINCT surface from the existing trading-performance leaderboard
-- (profiles.public_profile / trader_leaderboard()): a user may appear on one,
-- both, or neither.
--
-- Privacy model:
--   • leaderboard_opt_in defaults FALSE — participation is opt-in only.
--   • A user appears on the psychology board ONLY when leaderboard_opt_in = true
--     AND both consent timestamps are set (accepted Terms & Privacy).
--   • profiles has NO public/anon SELECT policy — these columns are readable
--     only by the row owner (RLS below) or the service role. Public exposure
--     happens solely through the /api/psychology/leaderboard route, which runs
--     with the service role and returns ONLY aggregate scores (maturity /
--     discipline / consistency / patience) + rank/percentile — never raw
--     journal rows, never PII beyond a chosen public_handle or an anonymized
--     "Trader-XXXX" token.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists terms_accepted_at   timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists leaderboard_opt_in  boolean not null default false;

-- Fast lookup of the (small) set of opted-in participants.
create index if not exists idx_profiles_leaderboard_opt_in
  on public.profiles (leaderboard_opt_in)
  where leaderboard_opt_in = true;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Self read/update of these settings is already granted by the policies created
-- in 20240101000000_initial_schema.sql:
--   • "Users can view own profile"   — select using (auth.uid() = id)
--   • "Users can update own profile" — update using (auth.uid() = id)
-- The new columns are part of public.profiles, so they inherit those policies:
-- a user can read and update their own consent flags, and cannot read anyone
-- else's. No public SELECT policy exists on profiles, so opt-in state and
-- consent timestamps are never exposed through the anon/authenticated PostgREST
-- surface. We intentionally add NO new policy here — widening profiles access
-- would risk leaking the very fields this feature is meant to gate.

comment on column public.profiles.terms_accepted_at   is 'When the user accepted Terms of Service (set on psychology leaderboard opt-in).';
comment on column public.profiles.privacy_accepted_at is 'When the user accepted the Privacy Policy (set on psychology leaderboard opt-in).';
comment on column public.profiles.leaderboard_opt_in  is 'Opt-in to PUBLIC psychology rankings. Default false. Requires both consent timestamps to appear on the board.';
