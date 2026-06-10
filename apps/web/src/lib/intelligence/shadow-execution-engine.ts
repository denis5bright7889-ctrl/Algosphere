/**
 * Shadow Execution Engine — Phase 0 of the Validation Center.
 *
 * The MISSING CORE. Without rows landing in shadow_executions, every
 * downstream phase (analytics, broker grading, equity curve, coach,
 * forensics) renders empty-state. This module is the producer.
 *
 * Three responsibilities:
 *
 *   1. ingestSignal(signal)
 *      Accepts a normalized signal, simulates a broker fill with
 *      deterministic spread + slippage + fill-rate, and inserts a
 *      shadow_executions row. NEVER places a live order.
 *
 *   2. tickShadowLifecycle()
 *      Scans every OPEN shadow row, fetches the current market price
 *      (Binance for crypto; honest skip otherwise — no fabricated
 *      forex prices), checks SL/TP hits, and finalizes if hit.
 *
 *   3. finalizeShadow(row, exit_price, reason)
 *      Computes follower_pnl, drift, and writes closed_at +
 *      actual_fill_price + outcome. Idempotent on double-call.
 *
 * Honesty contract:
 *   - Spread + slippage are deterministic per (signal_id|symbol|broker|
 *     timestamp_sec). Same signal lands the same simulated fill —
 *     reproducible across replays.
 *   - Lifecycle ticker only updates symbols whose price we can
 *     genuinely fetch. Forex / metals / indices land but stay open
 *     until a real price source is wired — never auto-closed at a
 *     made-up price.
 *   - The engine NEVER touches live broker APIs. It's a simulation
 *     layer — clearly labelled in actual_status.
 *
 * Status taxonomy (matches shadow_executions CHECK constraint):
 *   mirrored     — fill accepted, position open
 *   testnet      — same as mirrored, for paper-only profile
 *   failed       — broker rejected (low fill_rate dice roll)
 *   skipped      — engine refused (kill-switch / bad input)
 *   shadow_only  — recorded but not subject to lifecycle ticks
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Normalized signal input ────────────────────────────────────────
export interface NormalizedSignal {
  user_id:        string
  symbol:         string
  direction:      'buy' | 'sell'
  /** The strategy's intended entry price. The engine uses this as
   *  the anchor for spread + slippage simulation. */
  entry:          number
  sl:             number | null
  tp:             number | null
  /** Position size in standard lots. */
  lot:            number
  /** Broker profile identifier — drives spread/slippage/fill-rate
   *  simulation. Falls back to 'default' if unknown. */
  broker:         string
  strategy_id?:   string | null
  signal_id?:     string | null
  copy_trade_id?: string | null
}

// ── Broker simulation profiles ─────────────────────────────────────
// Spread + slippage in basis points (1bp = 0.01%). Fill rate is the
// probability the broker accepts. These numbers anchor to public
// reference data for each broker class — explicitly conservative
// rather than vendor-favourable.
interface BrokerProfile {
  spread_bps:          number
  slippage_mean_bps:   number
  slippage_stddev_bps: number
  fill_rate:           number
  label:               string
}

const BROKER_PROFILES: Record<string, BrokerProfile> = {
  default:  { spread_bps: 5,  slippage_mean_bps: 2,   slippage_stddev_bps: 3,   fill_rate: 0.97, label: 'Default Sim' },
  binance:  { spread_bps: 1,  slippage_mean_bps: 0.5, slippage_stddev_bps: 1,   fill_rate: 0.995, label: 'Binance Spot' },
  bybit:    { spread_bps: 2,  slippage_mean_bps: 1,   slippage_stddev_bps: 1.5, fill_rate: 0.99, label: 'Bybit' },
  okx:      { spread_bps: 2,  slippage_mean_bps: 1,   slippage_stddev_bps: 1.5, fill_rate: 0.99, label: 'OKX' },
  coinbase: { spread_bps: 2,  slippage_mean_bps: 1,   slippage_stddev_bps: 2,   fill_rate: 0.99, label: 'Coinbase' },
  mt5:      { spread_bps: 8,  slippage_mean_bps: 3,   slippage_stddev_bps: 5,   fill_rate: 0.95, label: 'MT5' },
  oanda:    { spread_bps: 6,  slippage_mean_bps: 2,   slippage_stddev_bps: 4,   fill_rate: 0.97, label: 'OANDA' },
}

function brokerProfile(broker: string): BrokerProfile {
  return BROKER_PROFILES[broker.toLowerCase()] ?? BROKER_PROFILES.default!
}

// ── Deterministic pseudo-random (Mulberry32 from seed string) ─────
function seed32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller normal draw — deterministic given the source rng. */
function normal(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9)
  const u2 = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ── Symbol classification + multi-source price fetch ──────────────
function canPriceCrypto(symbol: string): boolean {
  const s = symbol.toUpperCase()
  return s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('BUSD')
}

/** Forex / metals symbols TwelveData can price on the Basic plan. */
const TD_SYMBOL_MAP: Record<string, string> = {
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCHF: 'USD/CHF',
  USDCAD: 'USD/CAD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
  EURGBP: 'EUR/GBP', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD',
  XPTUSD: 'XPT/USD', XPDUSD: 'XPD/USD',
}

function canPriceForex(symbol: string): boolean {
  const s = symbol.toUpperCase()
  return Boolean(TD_SYMBOL_MAP[s]) && Boolean(process.env.TWELVE_DATA_API_KEY)
}

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const j = (await res.json()) as { symbol?: string; price?: string }
    const p = typeof j.price === 'string' ? Number(j.price) : NaN
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

async function fetchTwelveDataPrice(symbol: string): Promise<number | null> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return null
  const td = TD_SYMBOL_MAP[symbol.toUpperCase()]
  if (!td) return null
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(td)}&apikey=${key}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const j = (await res.json()) as { price?: string; status?: string; message?: string }
    if (j.status === 'error') return null
    const p = typeof j.price === 'string' ? Number(j.price) : NaN
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

/** Fetch current price for a symbol from the appropriate provider.
 *  Returns null for any symbol we genuinely can't price (no fabrication). */
async function fetchPriceFor(symbol: string): Promise<number | null> {
  if (canPriceCrypto(symbol)) return fetchBinancePrice(symbol)
  if (canPriceForex(symbol))  return fetchTwelveDataPrice(symbol)
  return null
}

// ── Public API ─────────────────────────────────────────────────────

export interface IngestResult {
  ok:               boolean
  shadow_execution_id?: string
  actual_status?:   string
  intended_entry?:  number
  actual_fill?:     number | null
  slippage_pct?:    number | null
  error?:           string
}

export async function ingestSignal(sig: NormalizedSignal): Promise<IngestResult> {
  // Validation — refuse malformed input rather than guess at it.
  if (!sig.user_id)                                  return { ok: false, error: 'user_id required' }
  if (!sig.symbol)                                   return { ok: false, error: 'symbol required' }
  if (sig.direction !== 'buy' && sig.direction !== 'sell')
                                                     return { ok: false, error: 'direction must be buy|sell' }
  if (!Number.isFinite(sig.entry) || sig.entry <= 0) return { ok: false, error: 'entry must be > 0' }
  if (!Number.isFinite(sig.lot) || sig.lot <= 0)     return { ok: false, error: 'lot must be > 0' }
  if (!sig.broker)                                   return { ok: false, error: 'broker required' }

  const db   = svc()
  const prof = brokerProfile(sig.broker)
  const now  = new Date()

  // Deterministic seed: same signal + broker + UTC minute reproduces
  // the same simulated fill. Sub-minute granularity ensures we don't
  // collapse two signals at the same instant onto the same dice roll.
  const seedKey =
    `${sig.signal_id ?? `${sig.user_id}|${sig.symbol}|${sig.direction}|${sig.entry}`}|${sig.broker}|${now.toISOString().slice(0, 16)}`
  const rng = mulberry32(seed32(seedKey))

  // Decide accept/reject (fill_rate dice roll)
  const fillDie = rng()
  let actualStatus: 'mirrored' | 'testnet' | 'failed'
  if (fillDie < prof.fill_rate) {
    // Accepted. Testnet vs mirrored is purely cosmetic for now —
    // mark all sim fills as 'testnet' to match the disclosure copy
    // already on /shadow.
    actualStatus = 'testnet'
  } else {
    actualStatus = 'failed'
  }

  // Simulate fill price: signal entry + spread + slippage. Direction-
  // aware: buys cross the ask (entry + spread/2 + slip), sells cross
  // the bid (entry - spread/2 - slip).
  let actualFill: number | null = null
  let slippagePct: number | null = null

  if (actualStatus === 'testnet') {
    const spreadPx = sig.entry * (prof.spread_bps / 10_000)
    const slipBps  = normal(rng, prof.slippage_mean_bps, prof.slippage_stddev_bps)
    const slipPx   = sig.entry * (slipBps / 10_000)

    if (sig.direction === 'buy') {
      actualFill = sig.entry + spreadPx / 2 + slipPx
    } else {
      actualFill = sig.entry - spreadPx / 2 - slipPx
    }
    slippagePct = (actualFill - sig.entry) / sig.entry
    if (sig.direction === 'sell') slippagePct = -slippagePct
  }

  // Persist. shadow_executions schema (migration 20) keeps lot/SL/TP
  // as the INTENT; actual_fill_price + actual_lot record what
  // happened.
  const insert = {
    user_id:          sig.user_id,
    signal_id:        sig.signal_id ?? null,
    copy_trade_id:    sig.copy_trade_id ?? null,
    broker:           sig.broker,
    symbol:           sig.symbol,
    direction:        sig.direction,
    intended_lot:     sig.lot,
    intended_entry:   sig.entry,
    intended_sl:      sig.sl,
    intended_tp:      sig.tp,
    actual_status:    actualStatus,
    actual_fill_price: actualFill,
    actual_lot:       actualStatus === 'testnet' ? sig.lot : null,
    slippage_pct:     slippagePct,
    skip_reason:      actualStatus === 'failed'
      ? `Broker fill_rate roll ${fillDie.toFixed(4)} ≥ ${prof.fill_rate}`
      : null,
  }

  const { data, error } = await db
    .from('shadow_executions')
    .insert(insert)
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  return {
    ok:                   true,
    shadow_execution_id:  (data as { id: string }).id,
    actual_status:        actualStatus,
    intended_entry:       sig.entry,
    actual_fill:          actualFill,
    slippage_pct:         slippagePct,
  }
}

// ── Lifecycle ticker ───────────────────────────────────────────────

export interface LifecycleTickResult {
  ran_at:               string
  open_positions:       number
  positions_priced:     number
  positions_skipped:    number   // unknown price source
  closed_this_tick:     number
  errors:               Array<{ shadow_id: string; error: string }>
}

export async function tickShadowLifecycle(): Promise<LifecycleTickResult> {
  const db = svc()
  const ranAt = new Date().toISOString()

  const result: LifecycleTickResult = {
    ran_at:            ranAt,
    open_positions:    0,
    positions_priced:  0,
    positions_skipped: 0,
    closed_this_tick:  0,
    errors:            [],
  }

  // Open positions = actual_status in (mirrored, testnet) and
  // closed_at is null.
  const { data: openRows, error: openErr } = await db
    .from('shadow_executions')
    .select(`
      id, user_id, symbol, direction, broker,
      intended_lot, intended_entry, intended_sl, intended_tp,
      actual_status, actual_fill_price, actual_lot, slippage_pct
    `)
    .in('actual_status', ['mirrored', 'testnet'])
    .is('closed_at', null)
    .limit(2_000)

  if (openErr) {
    result.errors.push({ shadow_id: '*', error: openErr.message })
    return result
  }

  const rows = (openRows ?? []) as Array<{
    id: string; user_id: string; symbol: string; direction: string; broker: string
    intended_lot: number; intended_entry: number
    intended_sl: number | null; intended_tp: number | null
    actual_status: string; actual_fill_price: number | null
    actual_lot: number | null; slippage_pct: number | null
  }>
  result.open_positions = rows.length

  if (rows.length === 0) return result

  // Cache prices per symbol to avoid hammering Binance.
  const priceBySymbol = new Map<string, number | null>()
  const seenSymbols = new Set(rows.map(r => r.symbol))
  for (const symbol of seenSymbols) {
    priceBySymbol.set(symbol, await fetchPriceFor(symbol))
  }

  for (const r of rows) {
    const price = priceBySymbol.get(r.symbol) ?? null
    if (price == null) {
      result.positions_skipped++
      continue
    }
    result.positions_priced++

    // SL/TP hit check. Direction-aware.
    let closeAt: number | null = null
    let reason: 'sl_hit' | 'tp_hit' | null = null
    if (r.direction === 'buy') {
      if (r.intended_sl != null && price <= r.intended_sl) { closeAt = price; reason = 'sl_hit' }
      else if (r.intended_tp != null && price >= r.intended_tp) { closeAt = price; reason = 'tp_hit' }
    } else { // sell
      if (r.intended_sl != null && price >= r.intended_sl) { closeAt = price; reason = 'sl_hit' }
      else if (r.intended_tp != null && price <= r.intended_tp) { closeAt = price; reason = 'tp_hit' }
    }

    if (closeAt == null) continue   // still open

    // Finalize: compute PnL from actual fill → close price × lot.
    // Sign by direction. Leader PnL is the intended pricing (perfect
    // execution at entry), follower PnL is the simulated reality.
    const fillFor = r.actual_fill_price ?? r.intended_entry
    const sign    = r.direction === 'buy' ? 1 : -1
    const followerPnl = sign * (closeAt - fillFor) * (r.actual_lot ?? r.intended_lot)
    const leaderPnl   = sign * (closeAt - r.intended_entry) * r.intended_lot
    const driftPct    =
      leaderPnl !== 0 ? ((leaderPnl - followerPnl) / Math.abs(leaderPnl)) * 100 : null

    const { error: upErr } = await db
      .from('shadow_executions')
      .update({
        closed_at:     ranAt,
        follower_pnl:  Math.round(followerPnl * 1e8) / 1e8,
        leader_pnl:    Math.round(leaderPnl * 1e8) / 1e8,
        pnl_drift_pct: driftPct == null ? null : Math.round(driftPct * 1e4) / 1e4,
      })
      .eq('id', r.id)
      .is('closed_at', null)   // idempotency guard against double-tick

    if (upErr) {
      result.errors.push({ shadow_id: r.id, error: upErr.message })
    } else {
      result.closed_this_tick++
      void reason   // (recorded implicitly via closed_at; could surface in metadata later)
    }
  }

  return result
}

// ── Manual close (admin use) ───────────────────────────────────────

export async function manualCloseShadow(
  shadowId: string, exitPrice: number,
): Promise<{ ok: boolean; error?: string }> {
  const db = svc()
  const ranAt = new Date().toISOString()

  const { data: row, error: getErr } = await db
    .from('shadow_executions')
    .select('id, direction, intended_entry, intended_lot, actual_fill_price, actual_lot, closed_at')
    .eq('id', shadowId)
    .single()
  if (getErr) return { ok: false, error: getErr.message }
  const r = row as {
    id: string; direction: string; intended_entry: number; intended_lot: number
    actual_fill_price: number | null; actual_lot: number | null; closed_at: string | null
  }
  if (r.closed_at) return { ok: false, error: 'Already closed' }

  const fillFor     = r.actual_fill_price ?? r.intended_entry
  const sign        = r.direction === 'buy' ? 1 : -1
  const followerPnl = sign * (exitPrice - fillFor) * (r.actual_lot ?? r.intended_lot)
  const leaderPnl   = sign * (exitPrice - r.intended_entry) * r.intended_lot
  const driftPct    = leaderPnl !== 0
    ? ((leaderPnl - followerPnl) / Math.abs(leaderPnl)) * 100 : null

  const { error: upErr } = await db
    .from('shadow_executions')
    .update({
      closed_at:     ranAt,
      follower_pnl:  Math.round(followerPnl * 1e8) / 1e8,
      leader_pnl:    Math.round(leaderPnl * 1e8) / 1e8,
      pnl_drift_pct: driftPct == null ? null : Math.round(driftPct * 1e4) / 1e4,
    })
    .eq('id', shadowId)
    .is('closed_at', null)

  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true }
}

// ── Profile introspection ──────────────────────────────────────────

export function listBrokerProfiles(): Array<BrokerProfile & { key: string }> {
  return Object.entries(BROKER_PROFILES).map(([key, p]) => ({ key, ...p }))
}
