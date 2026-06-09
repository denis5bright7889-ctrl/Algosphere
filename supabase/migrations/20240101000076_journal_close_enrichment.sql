-- 20240101000076_journal_close_enrichment.sql
--
-- Phase 1 close-enrichment storage. The broker reconciler (Phase 3)
-- now enriches POSITION_CLOSED events with the closing deal record
-- from the broker — exit_price, realized_pnl, commission, swap, and
-- the broker's own close_time. The previous trigger persisted only
-- exit_price + pnl. This migration:
--
--   1. Adds commission + swap + closed_at columns on journal_entries.
--   2. Replaces the trigger function so POSITION_CLOSED writes them
--      from the payload. exit_price + pnl writes preserved verbatim.
--   3. Falls back gracefully: an unenriched close still updates
--      exit_price/pnl/duration as before; commission/swap stay NULL
--      until a subsequent enriched event arrives.
--
-- Backward-compat: existing rows untouched. Manual journal entries
-- via /api/journal still ignore these fields unless the form starts
-- providing them (intentional — Phase 1 is broker reality only).

-- ─── 1. New columns ────────────────────────────────────────────────
ALTER TABLE public.journal_entries
  -- Broker-reported commission for the closed trade (USD-equiv,
  -- already account-quote denominated by MT5). NULL until the
  -- enriched close lands.
  ADD COLUMN IF NOT EXISTS commission NUMERIC(12,4),
  -- Overnight financing / rollover. Sign mirrors MT5: negative when
  -- the trader pays, positive when they receive.
  ADD COLUMN IF NOT EXISTS swap       NUMERIC(12,4),
  -- The broker's own close timestamp (deal.time). Different from
  -- created_at (which is when the engine SAW the close happen, not
  -- when MT5 booked it). Useful for accurate session/duration math.
  ADD COLUMN IF NOT EXISTS closed_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_journal_closed_at
  ON public.journal_entries (closed_at DESC)
  WHERE closed_at IS NOT NULL;


-- ─── 2. Trigger function — extended POSITION_CLOSED handling ──────
-- Identical to migration 75 for ORDER_FILLED. POSITION_CLOSED branch
-- now also writes commission / swap / closed_at when the payload
-- carries them.

CREATE OR REPLACE FUNCTION public.auto_journal_from_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p           JSONB;
  v_symbol    TEXT;
  v_side      TEXT;
  v_dir       TEXT;
  v_entry     NUMERIC;
  v_exit      NUMERIC;
  v_qty       NUMERIC;
  v_posid     TEXT;
  v_pnl       NUMERIC;
  v_open_at   TIMESTAMPTZ;
  v_dur_ms    BIGINT;
  v_source    TEXT;
  v_comm      NUMERIC;
  v_swap      NUMERIC;
  v_closed_at TIMESTAMPTZ;
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

      v_source := CASE WHEN COALESCE(p->>'source', '') = 'detected'
                       THEN 'auto_human'
                       ELSE 'auto_engine' END;

      IF v_symbol = '' OR v_dir IS NULL THEN
        RETURN NEW;
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
      NULL;
    END;
    RETURN NEW;
  END IF;

  -- ── EXIT: POSITION_CLOSED → update the matching open row ─────────
  -- Now also persists commission / swap / closed_at when the payload
  -- carries them (enriched=true) per Phase 3 of close-enrichment.
  IF NEW.event_type = 'POSITION_CLOSED' THEN
    BEGIN
      v_posid     := COALESCE(p->>'position_id', p->>'order_id');
      v_exit      := NULLIF(p->>'exit','')::NUMERIC;
      v_pnl       := NULLIF(p->>'realized_pnl','')::NUMERIC;
      v_comm      := NULLIF(p->>'commission','')::NUMERIC;
      v_swap      := NULLIF(p->>'swap','')::NUMERIC;
      -- close_time is the broker's deal.time (ISO-8601 UTC). Fall back
      -- to NEW.created_at when unenriched so closed_at is never NULL
      -- on a closed row.
      v_closed_at := COALESCE(
        NULLIF(p->>'close_time','')::TIMESTAMPTZ,
        NEW.created_at
      );

      IF v_posid IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT created_at INTO v_open_at
        FROM public.journal_entries
        WHERE user_id = NEW.user_id
          AND auto_position_id = v_posid
          AND source IN ('auto_human','auto_engine','auto')
          AND exit_price IS NULL
        ORDER BY created_at DESC
        LIMIT 1;

      IF v_open_at IS NOT NULL THEN
        v_dur_ms := EXTRACT(EPOCH FROM (v_closed_at - v_open_at))::BIGINT * 1000;
        UPDATE public.journal_entries
          SET exit_price  = v_exit,
              pnl         = v_pnl,
              duration_ms = v_dur_ms,
              commission  = COALESCE(v_comm,      commission),
              swap        = COALESCE(v_swap,      swap),
              closed_at   = COALESCE(v_closed_at, closed_at)
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
