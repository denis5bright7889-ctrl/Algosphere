-- ─────────────────────────────────────────────────────────────────────────────
-- AlgoSphere Quant — Affiliate / Referral System
--
-- Additive. The `referrals` table already exists (initial schema). This adds:
--   • profiles.referral_code (public, URL-safe, deterministic, unique)
--   • referrals lifecycle columns (status / commission_amount / plan / timestamps)
--   • attribution wired into the existing handle_new_user() trigger
--     (preserves all prior behaviour; referral failure NEVER blocks signup)
--
-- Conversion (signed_up → converted) and payout (→ paid) are written by the
-- service role from app code, which bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Public referral code on every profile -----------------------------------
alter table public.profiles
  add column if not exists referral_code text;

-- Deterministic 8-char code from the user id (not a secret — it is a public
-- affiliate link). Deterministic = idempotent backfill, no collision loop.
update public.profiles
  set referral_code = lower(substr(md5(id::text), 1, 8))
  where referral_code is null;

alter table public.profiles
  alter column referral_code set not null;

create unique index if not exists idx_profiles_referral_code
  on public.profiles (referral_code);

-- 2. Referral lifecycle columns ----------------------------------------------
alter table public.referrals
  add column if not exists status            text        not null default 'signed_up',
  add column if not exists commission_amount numeric     not null default 0,
  add column if not exists plan              text,
  add column if not exists converted_at      timestamptz,
  add column if not exists paid_at           timestamptz;

alter table public.referrals
  drop constraint if exists referrals_status_check;
alter table public.referrals
  add constraint referrals_status_check
  check (status in ('signed_up', 'converted', 'paid'));

create index if not exists idx_referrals_referrer_status
  on public.referrals (referrer_id, status);

-- 3. Attribution — extend handle_new_user() ----------------------------------
-- Preserves the original behaviour (create profile w/ full_name) and ADDS:
--   • generate the new profile's referral_code
--   • if signup metadata carries a valid referral_code, link the two users
-- The referral block is exception-guarded: a bad/missing code can never
-- prevent account creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_code   text;
  v_referrer   uuid;
begin
  insert into public.profiles (id, full_name, referral_code)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    lower(substr(md5(new.id::text), 1, 8))
  );

  begin
    v_ref_code := nullif(trim(new.raw_user_meta_data->>'referral_code'), '');
    if v_ref_code is not null then
      select id into v_referrer
        from public.profiles
        where referral_code = lower(v_ref_code)
        limit 1;

      -- Must exist and must not be a self-referral
      if v_referrer is not null and v_referrer <> new.id then
        insert into public.referrals (referrer_id, referred_id, status)
        values (v_referrer, new.id, 'signed_up')
        on conflict (referrer_id, referred_id) do nothing;
      end if;
    end if;
  exception when others then
    -- Never block signup on referral attribution problems
    null;
  end;

  return new;
end;
$$;

-- 4. RLS — let a referred user's row be inserted by the definer trigger only.
-- Existing SELECT policy ("Users can view own referrals" on referrer_id) stays.
-- Referrers must also be able to see commission columns (same row) — covered.
