-- 20240101000052_refocus_drop_orphan_tables.sql
--
-- Refocus R6: drop the 10 truly-orphan tables left over from the
-- retired social / launchpad / discussion surfaces.
--
-- THIS MIGRATION IS DESTRUCTIVE. Once applied, the rows in these
-- tables are gone. Verify intent BEFORE running supabase db push.
--
-- Scope rule for R6
-- -----------------
-- Every table dropped here has been confirmed to have ZERO references
-- in the post-R2/R3/R4/R4b/R5 codebase (excluding auto-generated
-- `supabase/database.types.ts`, which is regenerated from the schema
-- and will lose the type entries automatically when the table is
-- dropped). A grep was run against apps/web/src and apps/signal-engine
-- on the R5 tip; the report is in the PR body.
--
-- Tables NOT dropped here (deferred to R7 — code cleanup first)
-- -------------------------------------------------------------
-- The following retired-surface tables are STILL READ by kept pages
-- and must have their callers cleaned up before they can be dropped:
--   copy_health, copy_jobs, copy_jobs_dlq, copy_reconciliation,
--   copy_trades                      ← read by /algo, /execution,
--                                       /command, /admin/ops,
--                                       /execution/monitor,
--                                       /risk/exposure, api/admin/dlq
--   social_posts, social_notifications ← read by NotificationBell
--                                       (TopBar, every page),
--                                       /settings, admin/reports,
--                                       ai-signal-commentary
--   published_strategies,
--   strategy_subscriptions,
--   trader_follows, trader_scores,
--   trader_verifications            ← read by /achievements, /market,
--                                       /verification, admin/verification,
--                                       lib/trader-scoring
--   discussion_threads,
--   discussion_replies              ← read by useRealtimeThreads,
--                                       admin/reports
--   signal_events                   ← read by lib/signal-bus
--
-- R7 will remove the queries first, then drop those tables.
--
-- FK safety
-- ---------
-- Drops use CASCADE so any incoming foreign keys (from other retired
-- tables we're dropping in the same migration, OR from indices /
-- policies / triggers attached directly to the table) are removed
-- cleanly. IF EXISTS makes the file idempotent — re-running after a
-- prior partial run is safe.

BEGIN;

-- ── Social engagement tables (no FKs out; safe to drop first) ─────
DROP TABLE IF EXISTS public.social_post_reactions   CASCADE;
DROP TABLE IF EXISTS public.social_post_saves       CASCADE;
DROP TABLE IF EXISTS public.strategy_reviews        CASCADE;

-- ── Discussion votes (sibling of discussion_threads/replies; safe
--    to drop without the parents because votes only point INTO the
--    threads, never out) ─────────────────────────────────────────
DROP TABLE IF EXISTS public.discussion_votes        CASCADE;

-- ── Creator monetization (R2's social earnings layer) ────────────
DROP TABLE IF EXISTS public.creator_payout_requests CASCADE;
DROP TABLE IF EXISTS public.creator_earnings        CASCADE;

-- ── Community memberships (premium_communities was the catalogue;
--    membership was the join table). Both go in the same migration. ─
DROP TABLE IF EXISTS public.community_memberships   CASCADE;
DROP TABLE IF EXISTS public.premium_communities     CASCADE;

-- ── Launchpad ────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.launch_investors        CASCADE;
DROP TABLE IF EXISTS public.token_launches          CASCADE;

COMMIT;

COMMENT ON SCHEMA public IS
  'Refocus R6 cleanup applied 2026-05-XX — see migration 052 for the orphan-table drop list.';
