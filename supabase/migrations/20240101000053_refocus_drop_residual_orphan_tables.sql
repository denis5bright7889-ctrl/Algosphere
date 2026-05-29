-- 20240101000053_refocus_drop_residual_orphan_tables.sql
--
-- Refocus R7: drop the 15 tables that R6 deferred.
--
-- Pairs with the R7 code-query cleanup (PR #69). After that PR merges,
-- every grep for these tables in the codebase comes back empty except
-- for the auto-generated supabase/database.types.ts (regenerated from
-- schema → entries disappear when the table is dropped).
--
-- THIS MIGRATION IS DESTRUCTIVE. Apply only AFTER PR #69 has merged
-- and the no-references invariant has been re-verified on main.
--
-- Drop ordering uses CASCADE so any incoming foreign keys or
-- triggers / RLS policies attached directly are cleaned up. IF EXISTS
-- makes the file idempotent — re-running after a prior partial run is
-- safe.
--
-- Tables dropped here (15)
-- ------------------------
-- Copy-engine residue (the orchestrator / executor service was
-- deleted in R2; these tables were its inputs / outputs):
--   copy_jobs, copy_jobs_dlq, copy_reconciliation, copy_health,
--   copy_trades
--
-- Social engagement (the public posting + threading surface was
-- retired in R2):
--   social_posts, social_notifications, discussion_threads,
--   discussion_replies
--
-- Leaderboard derivatives (the public trader-ranking surface was
-- retired; trader-intelligence dashboard is the new home for
-- individual self-tracking):
--   trader_scores, trader_follows, trader_verifications,
--   strategy_subscriptions, published_strategies
--
-- Engine event bus (signal-bus.ts was the writer; deleted in R7):
--   signal_events

BEGIN;

-- ── Copy-engine outputs (the queue + DLQ first, then trades) ──────
DROP TABLE IF EXISTS public.copy_jobs            CASCADE;
DROP TABLE IF EXISTS public.copy_jobs_dlq        CASCADE;
DROP TABLE IF EXISTS public.copy_reconciliation  CASCADE;
DROP TABLE IF EXISTS public.copy_health          CASCADE;
DROP TABLE IF EXISTS public.copy_trades          CASCADE;

-- ── Social engagement (threading children before parents) ─────────
DROP TABLE IF EXISTS public.discussion_replies   CASCADE;
DROP TABLE IF EXISTS public.discussion_threads   CASCADE;
DROP TABLE IF EXISTS public.social_notifications CASCADE;
DROP TABLE IF EXISTS public.social_posts         CASCADE;

-- ── Leaderboard derivatives ───────────────────────────────────────
DROP TABLE IF EXISTS public.trader_follows       CASCADE;
DROP TABLE IF EXISTS public.trader_verifications CASCADE;
DROP TABLE IF EXISTS public.trader_scores        CASCADE;
DROP TABLE IF EXISTS public.strategy_subscriptions CASCADE;
DROP TABLE IF EXISTS public.published_strategies CASCADE;

-- ── Engine event bus ──────────────────────────────────────────────
DROP TABLE IF EXISTS public.signal_events        CASCADE;

COMMIT;

COMMENT ON SCHEMA public IS
  'Refocus R7 cleanup — see migration 053 for the residual orphan drop.';
