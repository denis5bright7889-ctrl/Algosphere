-- ============================================================
-- Journal auto-detection — Phase 2 foundation
-- Migration: 20240101000029_journal_auto_detection.sql
--
-- Adds the load-bearing piece of the auto-journal system: a DB
-- trigger that turns every execution event the engine writes into
-- (or updates) a journal_entries row. No application code changes
-- required — the engine already emits ORDER_FILLED / POSITION_CLOSED
-- events into public.execution_events (see paper_adapter +
-- mt5/binance/bybit/okx writeback paths).
--
-- Strict invariants:
--   • Trigger writes to journal_entries only; does NOT touch
--     execution_events, broker_connections, or any trading-critical
--     table. Cannot delay order execution.
--   • SECURITY DEFINER + explicit search_path so RLS is bypassed in a
--     controlled way (service-role inserts to execution_events flow
--     through the same definer context — same as handle_new_user).
--   • EXCEPTION-guarded body: any failure (malformed payload, missing
--     field) is swallowed silently. A broken auto-journal must never
--     block the order-event insert.
--   • source = 'auto' for trigger-created rows; manual /journal entries
--     keep source = 'manual'. UI filters on this.
-- ============================================================

-- 1. New columns on journal_entries -----------------------------------

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto')),
  -- Links the journal row to the execution_events row that birthed it.
  -- For an "auto" row, this is the ORDER_FILLED event id; the matching
  -- POSITION_CLOSED event updates the same row (via auto_position_id).
  ADD COLUMN IF NOT EXISTS execution_event_id UUID
    REFERENCES public.execution_events(id) ON DELETE SET NULL,
  -- Stable key linking the entry-fill event to its eventual exit event
  -- (the paper adapter uses the same UUID for order_id + position_id;
  --  the real adapters reuse broker_pos_id similarly).
  ADD COLUMN IF NOT EXISTS auto_position_id TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms       BIGINT,
  ADD COLUMN IF NOT EXISTS slippage_pct      NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS regime_at_entry   TEXT,
  ADD COLUMN IF NOT EXISTS broker            TEXT,
  -- AI-generated classification tags (breakout, reversal, trend,
  -- scalp, news, revenge, overtrade...). Written by a separate
  -- background tagger (Phase 2 follow-up), starts NULL.
  ADD COLUMN IF NOT EXISTS ai_tags           TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_journal_source
  ON public.journal_entries (user_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_auto_position
  ON public.journal_entries (auto_position_id)
  WHERE auto_position_id IS NOT NULL;

-- 2. Trading-session helper -------------------------------------------
-- Maps a UTC timestamp to one of the major sessions. The journal
-- already has a `session` column from v2; this just fills it for auto
-- rows so the analytics queries work uniformly.

CREATE OR REPLACE FUNCTION public.trading_session_for(ts TIMESTAMPTZ)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  h INTEGER;
BEGIN
  h := EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC')::INTEGER;
  -- Approximate session windows (UTC). London 07-16, NY 12-21,
  -- overlap 12-16 wins, Asia 00-08, otherwise off_hours.
  IF h BETWEEN 12 AND 15 THEN RETURN 'overlap'; END IF;
  IF h BETWEEN  7 AND 16 THEN RETURN 'london';  END IF;
  IF h BETWEEN 12 AND 20 THEN RETURN 'new_york';END IF;
  IF h BETWEEN  0 AND  7 THEN RETURN 'asia';    END IF;
  RETURN 'off_hours';
END;
$$;

-- 3. The trigger function ---------------------------------------------
-- Handles ORDER_FILLED (creates the row) and POSITION_CLOSED (updates
-- the matching auto row with exit/pnl/duration). Other event types
-- (ORDER_REJECTED, PAPER_INIT, RISK_TRIGGERED, …) are ignored.

CREATE OR REPLACE FUNCTION public.auto_journal_from_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p          JSONB;
  v_symbol   TEXT;
  v_side     TEXT;
  v_dir      TEXT;
  v_entry    NUMERIC;
  v_exit     NUMERIC;
  v_qty      NUMERIC;
  v_posid    TEXT;
  v_pnl      NUMERIC;
  v_open_at  TIMESTAMPTZ;
  v_dur_ms   BIGINT;
BEGIN
  p := COALESCE(NEW.payload, '{}'::jsonb);

  -- ── ENTRY: ORDER_FILLED → create the auto journal row ────────────
  IF NEW.event_type = 'ORDER_FILLED' THEN
    BEGIN
      v_symbol := COALESCE(p->>'symbol', '');
      v_side   := lower(COALESCE(p->>'side', ''));
      v_dir    := CASE WHEN v_side IN ('buy','long')  THEN 'buy'
                       WHEN v_side IN ('sell','short') THEN 'sell'
                       ELSE NULL END;
      v_entry  := NULLIF(p->>'avg_fill_price','')::NUMERIC;
      v_qty    := NULLIF(p->>'filled_qty','')::NUMERIC;
      v_posid  := COALESCE(p->>'order_id', p->>'position_id');

      IF v_symbol = '' OR v_dir IS NULL THEN
        RETURN NEW;   -- malformed payload; skip silently
      END IF;

      INSERT INTO public.journal_entries (
        user_id, pair, direction, entry_price, lot_size, trade_date,
        source, execution_event_id, auto_position_id, broker,
        slippage_pct, session, created_at
      ) VALUES (
        NEW.user_id, v_symbol, v_dir, v_entry, v_qty,
        (NEW.created_at AT TIME ZONE 'UTC')::date,
        'auto', NEW.id, v_posid, NEW.broker,
        NULLIF(p->>'slippage_pct','')::NUMERIC,
        public.trading_session_for(NEW.created_at),
        NEW.created_at
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Auto-journal failure must NEVER block the execution_events
      -- insert. Log silently, move on.
      NULL;
    END;
    RETURN NEW;
  END IF;

  -- ── EXIT: POSITION_CLOSED → update the matching open row ─────────
  IF NEW.event_type = 'POSITION_CLOSED' THEN
    BEGIN
      v_posid := COALESCE(p->>'position_id', p->>'order_id');
      v_exit  := NULLIF(p->>'exit','')::NUMERIC;
      v_pnl   := NULLIF(p->>'realized_pnl','')::NUMERIC;
      IF v_posid IS NULL THEN
        RETURN NEW;
      END IF;

      -- Find the open auto row + compute duration in one update.
      SELECT created_at INTO v_open_at
        FROM public.journal_entries
        WHERE user_id = NEW.user_id
          AND auto_position_id = v_posid
          AND source = 'auto'
          AND exit_price IS NULL
        ORDER BY created_at DESC
        LIMIT 1;

      IF v_open_at IS NOT NULL THEN
        v_dur_ms := EXTRACT(EPOCH FROM (NEW.created_at - v_open_at))::BIGINT * 1000;
        UPDATE public.journal_entries
          SET exit_price  = v_exit,
              pnl         = v_pnl,
              duration_ms = v_dur_ms
          WHERE user_id = NEW.user_id
            AND auto_position_id = v_posid
            AND source = 'auto'
            AND exit_price IS NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. The trigger itself -----------------------------------------------

DROP TRIGGER IF EXISTS trg_auto_journal_from_event ON public.execution_events;
CREATE TRIGGER trg_auto_journal_from_event
  AFTER INSERT ON public.execution_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_journal_from_event();

-- ============================================================
-- After this migration, no engine/web change is required for
-- auto-detection to start working. Every order the engine fills
-- (paper, binance, bybit, okx, mt5-via-bridge, oanda, tradovate)
-- writes an ORDER_FILLED event into execution_events; the trigger
-- creates the journal row. POSITION_CLOSED events close it.
--
-- AI tagging, daily/weekly notification jobs, and the AI coach
-- layer are separate follow-ups that read off the now-populated
-- journal_entries.
-- ============================================================
