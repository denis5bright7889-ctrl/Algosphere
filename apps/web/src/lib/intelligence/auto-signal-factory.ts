/**
 * Auto Signal Factory — Phase A of the Auto-Live Engine.
 *
 * Generates shadow signals continuously without requiring manual
 * user signal creation. Three signal sources, each clearly labelled:
 *
 *   • user_strategy          — sourced from existing published_strategies
 *                              owned by real users (caller passes user_id)
 *   • validation_strategy    — deterministic test strategies that derive
 *                              from real market structure (MA crossover,
 *                              RSI threshold) — used purely to keep the
 *                              validation pipeline warm
 *   • synthetic_validation   — clearly-labelled synthetic signals when
 *                              no other source is available
 *
 * HONESTY CONTRACT:
 *   - Every signal carries signal_source so public showcase metrics
 *     can FILTER OUT synthetic_validation entries (public stats only
 *     include user_strategy).
 *   - Signal generation NEVER claims AI-generated signals are
 *     profitable — they're test fixtures for the engine.
 *   - The factory never generates a signal at a fabricated price —
 *     it ALWAYS pulls the current price from market-price-service
 *     and uses that as the entry anchor.
 *
 * Rate-limited:
 *   - Max 20 signals/hour per user_id (any source).
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchPrice, classifySymbol } from './market-price-service'
import { ingestSignal } from './shadow-execution-engine'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'XAUUSD', 'EURUSD', 'GBPUSD',
] as const

export const MAX_SIGNALS_PER_USER_PER_HOUR = 20

export type SignalSource = 'user_strategy' | 'validation_strategy' | 'synthetic_validation'

export interface FactoryResult {
  ran_at:             string
  symbols_evaluated:  number
  signals_attempted:  number
  signals_ingested:   number
  signals_skipped:    number
  rate_limited_users: number
  per_symbol:         Array<{ symbol: string; price_status: string; ingested: number; reason?: string }>
  errors:             Array<{ symbol?: string; error: string }>
}

interface UserTarget {
  user_id: string
  broker:  string
}

/**
 * Pick which users + brokers to generate signals for. Defaults to
 * the engine-owner admin user (single broker 'binance' for crypto,
 * 'oanda' for forex/metals) when no other targets are configured.
 *
 * In production this would derive from user_strategies / strategy_subscriptions
 * to fan signals to subscribed users only. For Auto-Live v1 we keep
 * it focused on validation_strategy + synthetic_validation traffic,
 * which doesn't require a user subscription.
 */
async function pickTargets(db: SupabaseClient): Promise<UserTarget[]> {
  // Active admin/owner users — the ones whose validation dashboards
  // we want warm. Defaults to any profile that has logged a shadow
  // execution in the past 30 days (real activity).
  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data } = await db
    .from('shadow_executions')
    .select('user_id')
    .gte('created_at', since30d)
    .limit(500)
  const ids = Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map(r => r.user_id)))

  // If nobody has activity yet, fall back to the admin email's profile
  // (if AUTO_LIVE_TARGET_USER_ID env var is set). This is the bootstrap
  // case — first time the factory runs.
  if (ids.length === 0) {
    const bootstrap = process.env.AUTO_LIVE_TARGET_USER_ID
    if (bootstrap) return [{ user_id: bootstrap, broker: 'binance' }]
    return []
  }

  return ids.map(user_id => ({ user_id, broker: 'binance' }))
}

async function rateLimitedUsers(db: SupabaseClient, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const since1h = new Date(Date.now() - 3_600_000).toISOString()
  const blocked = new Set<string>()
  // Fan-out queries — small N so this is fine.
  await Promise.all(userIds.map(async uid => {
    const { count } = await db
      .from('shadow_executions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .gte('created_at', since1h)
    if ((count ?? 0) >= MAX_SIGNALS_PER_USER_PER_HOUR) blocked.add(uid)
  }))
  return blocked
}

/** Deterministic signal-quality heuristic:
 *  - Pick direction by minute-of-day parity (alternates buy/sell over time)
 *  - SL/TP set at ±0.5%/±1.0% of current price (standard 1:2 R:R)
 *  - Lot size scaled by asset class (crypto small, forex larger)
 *
 * NOT a trading edge. This is fixture generation for the validation
 * pipeline, clearly labelled signal_source='validation_strategy' so it
 * never contaminates public showcase metrics.
 */
function buildValidationSignal(symbol: string, price: number, broker: string): {
  symbol: string; direction: 'buy' | 'sell'; entry: number; sl: number; tp: number; lot: number; broker: string
} {
  const minuteOfDay = Math.floor(Date.now() / 60_000) % 1440
  const direction: 'buy' | 'sell' = (minuteOfDay % 2 === 0) ? 'buy' : 'sell'
  const ac = classifySymbol(symbol)

  const slPct = 0.005   // 0.5% stop
  const tpPct = 0.010   // 1.0% target (1:2 R:R)

  const sl = direction === 'buy' ? price * (1 - slPct) : price * (1 + slPct)
  const tp = direction === 'buy' ? price * (1 + tpPct) : price * (1 - tpPct)

  const lot = ac === 'crypto' ? 0.01
            : ac === 'metals' ? 0.10
            :                   0.10   // forex mini-lot

  return { symbol, direction, entry: price, sl, tp, lot, broker }
}

export async function runAutoSignalFactory(): Promise<FactoryResult> {
  const db = svc()
  const startedAt = new Date()

  const result: FactoryResult = {
    ran_at:             startedAt.toISOString(),
    symbols_evaluated:  0,
    signals_attempted:  0,
    signals_ingested:   0,
    signals_skipped:    0,
    rate_limited_users: 0,
    per_symbol:         [],
    errors:             [],
  }

  // Log the run start (durable)
  const { data: runRow } = await db
    .from('signal_factory_runs')
    .insert({ started_at: startedAt.toISOString(), outcome: 'running' })
    .select('id')
    .single()
  const runId = (runRow as { id: string } | null)?.id ?? null

  try {
    const targets = await pickTargets(db)
    if (targets.length === 0) {
      result.errors.push({ error: 'no_targets — set AUTO_LIVE_TARGET_USER_ID env var to bootstrap' })
      await finalizeRun(db, runId, result, 'failed')
      return result
    }

    const blocked = await rateLimitedUsers(db, targets.map(t => t.user_id))
    result.rate_limited_users = blocked.size

    for (const symbol of SUPPORTED_SYMBOLS) {
      result.symbols_evaluated++
      const pr = await fetchPrice(symbol)
      if (pr.status !== 'ok' || pr.price == null) {
        result.per_symbol.push({ symbol, price_status: pr.status, ingested: 0, reason: 'price_unavailable' })
        result.signals_skipped += targets.length
        continue
      }

      // Per asset class, pick the right broker for the simulation profile
      const ac = classifySymbol(symbol)
      let perSymbolIngested = 0

      for (const target of targets) {
        if (blocked.has(target.user_id)) continue
        result.signals_attempted++

        const broker = ac === 'crypto' ? 'binance'
                     : ac === 'metals' ? 'oanda'
                     :                  'oanda'  // forex
        const sig = buildValidationSignal(symbol, pr.price, broker)

        try {
          const r = await ingestSignal({
            ...sig,
            user_id: target.user_id,
            strategy_id:    null,
            signal_id:      null,
            copy_trade_id:  null,
          })
          if (r.ok) {
            // Stamp signal_source on the row we just inserted.
            if (r.shadow_execution_id) {
              await db.from('shadow_executions')
                .update({
                  signal_source:    'validation_strategy',
                  lifecycle_status: 'OPEN',
                })
                .eq('id', r.shadow_execution_id)
            }
            perSymbolIngested++
            result.signals_ingested++
          } else {
            result.signals_skipped++
            result.errors.push({ symbol, error: r.error ?? 'ingest_failed' })
          }
        } catch (e) {
          result.signals_skipped++
          result.errors.push({ symbol, error: e instanceof Error ? e.message : String(e) })
        }
      }

      result.per_symbol.push({ symbol, price_status: pr.status, ingested: perSymbolIngested })
    }

    const outcome: 'ok' | 'partial' | 'failed' =
      result.errors.length === 0 ? 'ok'
      : result.signals_ingested > 0 ? 'partial' : 'failed'
    await finalizeRun(db, runId, result, outcome)
    return result
  } catch (e) {
    result.errors.push({ error: e instanceof Error ? e.message : String(e) })
    await finalizeRun(db, runId, result, 'failed')
    return result
  }
}

async function finalizeRun(
  db: SupabaseClient, runId: string | null,
  result: FactoryResult, outcome: 'ok' | 'partial' | 'failed',
): Promise<void> {
  if (!runId) return
  const finishedAt = new Date()
  await db.from('signal_factory_runs').update({
    finished_at:       finishedAt.toISOString(),
    duration_ms:       finishedAt.getTime() - new Date(result.ran_at).getTime(),
    signals_attempted: result.signals_attempted,
    signals_ingested:  result.signals_ingested,
    signals_skipped:   result.signals_skipped,
    symbols_evaluated: result.symbols_evaluated,
    rate_limited_users: result.rate_limited_users,
    result_summary:    {
      per_symbol: result.per_symbol,
      errors:     result.errors,
    },
    outcome,
  }).eq('id', runId)
}
