-- 20240101000075_journal_trigger_v4_compat.sql
--
-- Fix the auto-journal trigger (migration 29) to use Journal V4's
-- new source enum. V4 (migration 56) widened the journal_entries
-- source CHECK from {manual, auto} → {manual, auto_human, auto_engine}
-- but the trigger function was never updated. Every reconciler-
-- detected ORDER_FILLED tried to INSERT source='auto', hit the CHECK
-- violation, and the EXCEPTION block silently swallowed the error —
-- producing the "53 ORDER_FILLED events, 0 journal entries" symptom
-- the diagnostic endpoint surfaced in prod (2026-06-09).
--
-- Mapping rule:
--   payload.source = 'detected'  →  auto_human
--     (reconciler-detected positions: the user opened these manually
--      on the broker. Per V4 doc: "today every broker import is
--      human-clicked".)
--   otherwise                    →  auto_engine
--     (engine-driven fills from the signal → execute path: the
--      AlgoSphere algo placed the order. V4 doc: "engine-execution
--      will land on auto_engine going forward".)
--
-- The POSITION_CLOSED lookup is widened to match {auto_human,
-- auto_engine} so closes find their open row regardless of which
-- branch created it.

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
  v_source   TEXT;
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

      -- V4 source mapping. Reconciler tags its events with
      -- payload.source='detected'; engine-driven fills don't.
      v_source := CASE WHEN COALESCE(p->>'source', '') = 'detected'
                       THEN 'auto_human'
                       ELSE 'auto_engine' END;

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
        v_source, NEW.id, v_posid, NEW.broker,
        NULLIF(p->>'slippage_pct','')::NUMERIC,
        public.trading_session_for(NEW.created_at),
        NEW.created_at
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Auto-journal failure must NEVER block the execution_events
      -- insert. Log silently, move on. (If we're back here after this
      -- migration, the diagnostics endpoint will show ORDER_FILLED >
      -- journal_auto and we'll know there's a fresh constraint
      -- mismatch to chase.)
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
      -- Widened to match either V4 source value so closes find their
      -- open row regardless of how it was created.
      SELECT created_at INTO v_open_at
        FROM public.journal_entries
        WHERE user_id = NEW.user_id
          AND auto_position_id = v_posid
          AND source IN ('auto_human','auto_engine','auto')
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
            AND source IN ('auto_human','auto_engine','auto')
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

-- ============================================================
-- BACKFILL — the 53 ORDER_FILLED events that landed before this fix
-- never produced journal rows. Replay them through the now-correct
-- trigger logic by emitting the same INSERT directly.
--
-- Idempotent: skips events that already have a matching journal row
-- (the ON CONFLICT clause + the LEFT JOIN below guard against double
-- inserts if this migration is re-run).
-- ============================================================

INSERT INTO public.journal_entries (
  user_id, pair, direction, entry_price, lot_size, trade_date,
  source, execution_event_id, auto_position_id, broker,
  slippage_pct, session, created_at
)
SELECT
  e.user_id,
  COALESCE(e.payload->>'symbol', '')                                AS pair,
  CASE WHEN lower(COALESCE(e.payload->>'side','')) IN ('buy','long')  THEN 'buy'
       WHEN lower(COALESCE(e.payload->>'side','')) IN ('sell','short') THEN 'sell'
       ELSE NULL END                                                AS direction,
  NULLIF(e.payload->>'avg_fill_price','')::NUMERIC                  AS entry_price,
  NULLIF(e.payload->>'filled_qty','')::NUMERIC                      AS lot_size,
  (e.created_at AT TIME ZONE 'UTC')::date                           AS trade_date,
  CASE WHEN COALESCE(e.payload->>'source','') = 'detected'
       THEN 'auto_human' ELSE 'auto_engine' END                     AS source,
  e.id                                                              AS execution_event_id,
  COALESCE(e.payload->>'order_id', e.payload->>'position_id')       AS auto_position_id,
  e.broker                                                          AS broker,
  NULLIF(e.payload->>'slippage_pct','')::NUMERIC                    AS slippage_pct,
  public.trading_session_for(e.created_at)                          AS session,
  e.created_at                                                      AS created_at
FROM public.execution_events e
LEFT JOIN public.journal_entries j ON j.execution_event_id = e.id
WHERE e.event_type = 'ORDER_FILLED'
  AND j.id IS NULL                                                  -- not yet journalled
  AND COALESCE(e.payload->>'symbol','') <> ''
  AND lower(COALESCE(e.payload->>'side','')) IN ('buy','long','sell','short')
ON CONFLICT DO NOTHING;

-- Apply the POSITION_CLOSED replay to update exits + pnl on the rows
-- we just backfilled. Same matching logic as the trigger.
WITH closes AS (
  SELECT
    e.user_id,
    COALESCE(e.payload->>'position_id', e.payload->>'order_id') AS posid,
    NULLIF(e.payload->>'exit','')::NUMERIC                       AS exit_price,
    NULLIF(e.payload->>'realized_pnl','')::NUMERIC               AS pnl,
    e.created_at                                                 AS closed_at
  FROM public.execution_events e
  WHERE e.event_type = 'POSITION_CLOSED'
    AND COALESCE(e.payload->>'position_id', e.payload->>'order_id') IS NOT NULL
)
UPDATE public.journal_entries j
   SET exit_price  = c.exit_price,
       pnl         = c.pnl,
       duration_ms = EXTRACT(EPOCH FROM (c.closed_at - j.created_at))::BIGINT * 1000
  FROM closes c
 WHERE j.user_id = c.user_id
   AND j.auto_position_id = c.posid
   AND j.source IN ('auto_human','auto_engine','auto')
   AND j.exit_price IS NULL;
