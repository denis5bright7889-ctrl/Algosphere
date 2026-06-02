-- 20240101000060_growth_automation.sql
--
-- Growth Engine V1 — Phase 4A: Automation Rules + Event Log.
--
-- Every meaningful event inside AlgoSphere (signal published, backtest
-- completed, weekly performance digest, new feature release, etc.)
-- can fire one or more automation_rules. Each rule decides whether to
-- emit a content_item draft, auto-schedule it on specific channels, or
-- auto-publish it (low-risk content types only).
--
-- growth_event_log = append-only audit. Every event the engine receives
-- lands here, with the matched rules and the resulting content_id (if
-- any). Operators read it from /admin/growth/automation.
--
-- All writes service-role only; RLS denies direct auth-user access.

-- ─── automation_rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_automation_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,

  -- Trigger — open enum so new event types don't require a migration.
  --   signal.published, signal.tp_hit, signal.sl_hit
  --   trade.opened, trade.closed
  --   backtest.completed
  --   strategy.released
  --   regime.changed, volatility.spiked
  --   performance.weekly, performance.monthly
  --   feature.released
  --   user.milestone
  --   manual.fire             (operator-triggered)
  event_type      text NOT NULL,

  -- Optional JSON predicate. Examples:
  --   { "min_confidence": 70 }       — only signals with quality_score >= 70
  --   { "min_trades": 30 }           — only backtests with sample >= 30
  --   { "grade_in": ["A","B"] }      — only A/B grade strategies
  -- The evaluator in lib/growth/automation.ts reads this. Schema-less by
  -- design so new predicates land without migrations.
  predicate       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What to produce. Maps to ContentKind in lib/growth/generators.ts.
  --   strategy_of_the_week, backtest_breakdown, market_report,
  --   product_update, psychology_insight, educational, announcement
  content_kind    text NOT NULL,

  -- Channels to auto-schedule. Empty array = "don't schedule, just
  -- create draft for admin review".
  channels        text[] NOT NULL DEFAULT '{}',

  -- Lifecycle: 'draft' = needs admin approval, 'approved' = ready to
  -- schedule, 'published' = fire immediately (low-risk types only —
  -- the API double-checks the kind is in the auto-publish whitelist).
  output_status   text NOT NULL DEFAULT 'draft'
                  CHECK (output_status IN ('draft','approved','published')),

  enabled         boolean NOT NULL DEFAULT true,
  -- Soft rate limit — how many times this rule can fire per day. Null
  -- = unlimited. Enforced by counting rows in growth_event_log.
  daily_cap       integer,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled_event
  ON public.growth_automation_rules (event_type)
  WHERE enabled = true;

CREATE OR REPLACE FUNCTION public.set_automation_rules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS automation_rules_updated_at ON public.growth_automation_rules;
CREATE TRIGGER automation_rules_updated_at
  BEFORE UPDATE ON public.growth_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_automation_rules_updated_at();


-- ─── event_log ───────────────────────────────────────────────────────
-- Append-only. Every event the /api/automation/events endpoint receives
-- lands here with the full payload + which rules matched + which
-- content_items were produced.
CREATE TABLE IF NOT EXISTS public.growth_event_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Which rule(s) matched + what was created. Both arrays mirror each
  -- other (rule_ids[i] produced content_ids[i]). Empty = no rule
  -- matched (or rule was rate-limited / disabled).
  rule_ids        uuid[] NOT NULL DEFAULT '{}',
  content_ids     uuid[] NOT NULL DEFAULT '{}',
  /** "ok" | "no_match" | "rate_limited" | "error" */
  outcome         text   NOT NULL DEFAULT 'ok',
  error           text,

  -- Where the event originated. 'signal-engine', 'web', 'cron', 'admin'.
  source          text NOT NULL DEFAULT 'unknown',

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_recent
  ON public.growth_event_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_type
  ON public.growth_event_log (event_type, created_at DESC);


-- ─── RLS — service role only ─────────────────────────────────────────
ALTER TABLE public.growth_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_event_log        ENABLE ROW LEVEL SECURITY;
-- No SELECT / INSERT / UPDATE / DELETE policies — every read/write goes
-- through the service-role admin endpoints.


-- ─── Seed defaults — 5 baseline rules ────────────────────────────────
-- ON CONFLICT DO NOTHING via the unique-on-name partial constraint
-- below so a re-run of this migration leaves operator edits alone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_rules_name
  ON public.growth_automation_rules (name);

INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels, output_status, daily_cap)
VALUES
  -- A new high-quality signal → draft a Strategy of the Week. Admin
  -- approval required (it's a performance claim).
  ('signal → Strategy of the Week draft',
   'When a confident signal publishes (quality_score >= 70), draft a Strategy of the Week post tied to that strategy.',
   'signal.published',
   '{"min_quality": 70}'::jsonb,
   'strategy_of_the_week',
   ARRAY['discord','telegram'],
   'draft',
   3),

  -- A clean backtest run → Backtest Breakdown draft. Admin approves.
  ('backtest → Backtest Breakdown draft',
   'When a backtest completes with grade in (A,B) and ≥30 trades, draft a Backtest Breakdown.',
   'backtest.completed',
   '{"grade_in":["A","B"], "min_trades":30}'::jsonb,
   'backtest_breakdown',
   ARRAY['discord','telegram','linkedin'],
   'draft',
   5),

  -- Weekly performance digest — auto-publishes (no perf claim, just stats).
  ('weekly digest → Market Report auto-publish',
   'Once a week, auto-publish a market intelligence digest summarising the prior 7-day platform activity.',
   'performance.weekly',
   '{}'::jsonb,
   'market_report',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1),

  -- New platform feature → Product Update draft. Admin approves
  -- (release notes wording matters).
  ('feature → Product Update draft',
   'When a new feature is released, draft a product update for review.',
   'feature.released',
   '{}'::jsonb,
   'product_update',
   ARRAY['discord','linkedin'],
   'draft',
   2),

  -- Manual fire — the catch-all for ad-hoc generation from the admin UI.
  ('manual → Educational draft',
   'Operator-triggered generation. Used by the "Generate now" button on /admin/growth/automation.',
   'manual.fire',
   '{}'::jsonb,
   'educational',
   ARRAY['discord'],
   'draft',
   NULL)
ON CONFLICT (name) DO NOTHING;


COMMENT ON TABLE public.growth_automation_rules IS
  'Phase 4A — event-driven rules that auto-create content drafts / scheduled posts. Service-role only.';
COMMENT ON TABLE public.growth_event_log IS
  'Phase 4A — append-only audit of every event the automation engine has received + what it produced.';
