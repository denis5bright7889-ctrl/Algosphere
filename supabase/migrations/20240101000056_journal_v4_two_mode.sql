-- ─────────────────────────────────────────────────────────────────────
-- Journal v4 — Two-Mode Intelligence
-- ─────────────────────────────────────────────────────────────────────
--
-- The Journal supports TWO distinct trade lifecycles that must never
-- be conflated:
--
--   1. Human-executed   — broker-imported trade where a HUMAN clicked
--      the order. The mechanics (entry/exit/PnL) are auto-imported;
--      psychology + thesis + reflection are required from the trader.
--   2. Engine-executed  — AlgoSphere automation engine published a
--      signal and the broker filled it. The engine knows everything —
--      strategy, entry logic, exit reason, risk model. NO psychology
--      is required (no psychology happened).
--
-- Schema changes:
--
--   • source CHECK constraint widens from {manual, auto} to
--     {manual, auto_human, auto_engine}. Existing 'auto' rows backfill
--     to 'auto_human' (today every broker import is human-clicked;
--     engine-execution will land on auto_engine going forward).
--
--   • Engine-specific columns added on journal_entries. Nullable for
--     human modes; populated automatically by the engine for auto_engine.
--
--   • Strategy-Intelligence Report can attach to engine trades via the
--     existing journal_coach_evaluations table — no new table needed.

-- ── 1. Backfill the legacy 'auto' value to 'auto_human' BEFORE widening
--    the constraint (otherwise the CHECK fails on existing rows). ─────
DO $$
BEGIN
  -- Drop the old CHECK constraint by walking pg_constraint — the name
  -- depends on creation order; we look it up by table + column instead.
  PERFORM 1 FROM pg_constraint
    WHERE conrelid = 'public.journal_entries'::regclass
      AND contype = 'c'
      AND consrc LIKE '%source%';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Drop any old source CHECK constraint (idempotent / name-agnostic).
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.journal_entries'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.journal_entries DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- Migrate legacy values.
UPDATE public.journal_entries
   SET source = 'auto_human'
 WHERE source = 'auto';

-- Reapply the widened CHECK.
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'auto_human', 'auto_engine'));

-- ── 2. Engine-execution columns (populated by the engine only) ──────
ALTER TABLE public.journal_entries
  -- Strategy provenance — which configured strategy generated the trade.
  ADD COLUMN IF NOT EXISTS engine_strategy_name      TEXT,
  ADD COLUMN IF NOT EXISTS engine_strategy_version   INTEGER,
  -- Why entry: the rule / confluence that triggered. Stored verbatim
  -- as the engine emits it so audit trails stay readable.
  ADD COLUMN IF NOT EXISTS engine_entry_logic        TEXT,
  -- Why exit: 'tp1_hit' | 'tp2_hit' | 'tp3_hit' | 'sl_hit' |
  -- 'trailing_stop' | 'risk_breach' | 'manual_close' | 'time_stop' …
  ADD COLUMN IF NOT EXISTS engine_exit_reason        TEXT,
  -- Risk model snapshot — which RiskGate flavour approved this trade.
  ADD COLUMN IF NOT EXISTS engine_risk_model         TEXT,
  -- Position sizing rationale — keeps the lot decision auditable.
  ADD COLUMN IF NOT EXISTS engine_position_sizing    TEXT,
  -- Volatility snapshot at entry, for regime/volatility analytics.
  ADD COLUMN IF NOT EXISTS engine_volatility_state   TEXT;

COMMENT ON COLUMN public.journal_entries.engine_strategy_name IS
  'Strategy name for engine-executed trades (source=auto_engine). NULL for human modes.';
COMMENT ON COLUMN public.journal_entries.engine_exit_reason IS
  'Why the engine closed the position. Authoritative — engine self-explains.';

-- ── 3. Strategy-Intelligence columns on coach evaluations ──────────
-- The same evaluation row that holds the 5 process grades for human
-- trades carries the strategy-intelligence dimensions for engine trades.
-- All nullable so the same row schema serves both modes.
ALTER TABLE public.journal_coach_evaluations
  -- Strategy quality dimensions (engine-mode primary).
  ADD COLUMN IF NOT EXISTS edge_stability_score      SMALLINT
    CHECK (edge_stability_score      IS NULL OR (edge_stability_score      BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS risk_stability_score      SMALLINT
    CHECK (risk_stability_score      IS NULL OR (risk_stability_score      BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS execution_consistency_score SMALLINT
    CHECK (execution_consistency_score IS NULL OR (execution_consistency_score BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS regime_compatibility_score SMALLINT
    CHECK (regime_compatibility_score IS NULL OR (regime_compatibility_score BETWEEN 0 AND 100)),
  -- Deployment readiness stage — replaces a letter grade for strategies.
  ADD COLUMN IF NOT EXISTS deployment_stage TEXT
    CHECK (deployment_stage IS NULL OR deployment_stage IN (
      'research', 'testing', 'validation', 'pilot', 'deployable', 'institutional'
    ));

-- ── 4. Helpful index for mode-aware queries ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_journal_source_v4
  ON public.journal_entries (user_id, source, trade_date DESC);
