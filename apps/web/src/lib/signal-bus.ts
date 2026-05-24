/**
 * Signal Bus — the event-driven copy pipeline's front door.
 *
 * Replaces the synchronous in-request `relayLeaderSignal` fan-out with a
 * single INSERT into `signal_events`. The web request returns in <5ms; the
 * copy-orchestrator worker (Railway) picks the event up, fans it out into
 * `copy_jobs`, and copy-executor replicas process them via the engine's
 * /api/v1/execute. See docs/COPY_TRADING_INFRASTRUCTURE.md.
 *
 * Idempotent + observable: every event auto-gets a `trace_id` (DB default)
 * threaded through to the eventual execution_events / journal_entries rows.
 * Returns the inserted (id, trace_id) so the caller can log the trace and
 * the UI can show "queued — workers processing".
 */
import { createServiceClient } from '@/lib/supabase/server'

export type SignalEventType = 'OPEN' | 'CLOSE' | 'MODIFY' | 'CANCEL'

export interface SignalBusEvent {
  leader_id:    string
  strategy_id?: string | null
  signal_id?:   string | null
  event_type:   SignalEventType
  symbol:       string
  direction?:   'buy' | 'sell' | null
  /** Free-form payload the executor consumes: entry, stop_loss,
   *  take_profit, lot, leader_equity, regime, etc. */
  payload?:     Record<string, unknown>
}

export interface PublishedEvent {
  id:       string
  trace_id: string
}

/**
 * Append one event to the bus. Service-role insert (bypasses RLS — workers
 * read with the same role). Returns null on insert failure; callers should
 * log + decide whether to surface to the user (typically: fire-and-forget,
 * the audit_log already captured the underlying action).
 */
export async function publishSignalEvent(
  ev: SignalBusEvent,
): Promise<PublishedEvent | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('signal_events')
    .insert({
      leader_id:   ev.leader_id,
      strategy_id: ev.strategy_id ?? null,
      signal_id:   ev.signal_id ?? null,
      event_type:  ev.event_type,
      symbol:      ev.symbol,
      direction:   ev.direction ?? null,
      payload:     ev.payload ?? {},
      status:      'pending',
    })
    .select('id, trace_id')
    .single()
  if (error) {
    console.error('publishSignalEvent failed:', error)
    return null
  }
  return data as PublishedEvent
}

/**
 * Convenience for the common OPEN case from a published `signals` row.
 * Maps the legacy signal shape (entry_price/stop_loss/take_profit_1) into
 * the event payload the executor expects (entry/stop_loss/take_profit).
 */
export async function publishOpenFromSignal(s: {
  id:            string
  pair:          string
  direction:     'buy' | 'sell'
  entry_price:   number | null
  stop_loss:     number | null
  take_profit_1: number | null
  created_by:    string
  strategy_id?:  string | null
  /** Optional leader sizing context — needed by equity_ratio / fixed_ratio
   *  allocation models. Falls back to risk_pct sizing (which only needs
   *  entry + stop_loss) when omitted. */
  lot?:          number
  leader_equity?: number
}): Promise<PublishedEvent | null> {
  return publishSignalEvent({
    leader_id:   s.created_by,
    strategy_id: s.strategy_id ?? null,
    signal_id:   s.id,
    event_type:  'OPEN',
    symbol:      s.pair,
    direction:   s.direction,
    payload: {
      entry:        s.entry_price,
      stop_loss:    s.stop_loss,
      take_profit:  s.take_profit_1,
      ...(s.lot !== undefined           ? { lot:           s.lot }           : {}),
      ...(s.leader_equity !== undefined ? { leader_equity: s.leader_equity } : {}),
    },
  })
}
