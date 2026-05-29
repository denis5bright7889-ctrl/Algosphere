/**
 * Signal-engine read client. Server-only — never import from a client
 * component (SIGNAL_ENGINE_URL is not exposed). All calls return
 * `{ ok: true, data } | { ok: false, error }` with bounded timeouts so
 * a degraded engine never crashes the rendering layer; the UI then
 * surfaces an honest "engine unreachable" state instead of fabricating
 * one.
 *
 * Endpoints mounted at `${SIGNAL_ENGINE_URL}/api/v1/...` (FastAPI app).
 * Read routes (/status, /risk/telemetry, /circuit-breaker) are public;
 * write routes require X-Engine-Key (not used here — reads only).
 */

const TIMEOUT_MS = 5000

export type Ok<T>  = { ok: true;  data: T }
export type Err    = { ok: false; error: string }
export type Result<T> = Ok<T> | Err

export interface EngineStatus {
  enabled:   boolean
  symbols:   string[]
  timeframe: string
  provider:  string
  websocket: { connections?: number } & Record<string, unknown>
  time:      string
}

export interface RiskTelemetry {
  state: 'ACTIVE' | 'COOLDOWN' | 'LOCKED'
  account_login?: string | number
  current_equity?:      number
  peak_equity?:         number
  initial_equity?:      number
  total_drawdown_pct?:  number
  daily_drawdown_pct?:  number
  weekly_drawdown_pct?: number
  daily_pnl?:           number
  weekly_pnl?:          number
  consecutive_wins?:    number
  consecutive_losses?:  number
  [k: string]: unknown
}

export interface CircuitBreaker {
  is_open:            boolean
  reason:             string | null
  consecutive_losses: number
  daily_losses:       number
}
export type CircuitBreakers = Record<string, CircuitBreaker>

function engineBase(): string | null {
  const raw = process.env.SIGNAL_ENGINE_URL
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

async function getJson<T>(path: string): Promise<Result<T>> {
  const base = engineBase()
  if (!base) return { ok: false, error: 'SIGNAL_ENGINE_URL not configured' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/v1${path}`, {
      signal:  ctrl.signal,
      headers: { accept: 'application/json' },
      // 10s in-process cache so /api/engine/status doesn't fan-out per
      // viewer; the engine's own state changes on a ~minute cadence.
      next: { revalidate: 10 },
    })
    if (!res.ok) {
      return { ok: false, error: `engine ${path} → HTTP ${res.status}` }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? 'timeout' : e.message)
      : 'fetch failed'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export interface TelemetryDistributions {
  generated_at:  string
  lookback_days: number
  total_signals: number
  confidence_distribution: {
    scored_signals: number
    buckets: { reject: number; reduced: number; standard: number; aggressive: number }
  }
  win_rate_by_regime: Record<string, {
    wins: number; losses: number; breakeven: number; closed: number; win_rate: number | null
  }>
  strategy_contribution: { available: boolean; note?: string; signals_with_strategies?: number; counts?: Record<string, number> }
  rejection_reasons:     { available: boolean; note?: string }
  mt5_reconnect_frequency: { available: boolean; note?: string; mt5_accounts?: number; connected?: number; failed?: number; failed_pct?: number }
}

export function getEngineStatus():   Promise<Result<EngineStatus>>   { return getJson('/status') }
export function getRiskTelemetry():  Promise<Result<RiskTelemetry>>  { return getJson('/risk/telemetry') }
export function getCircuitBreakers(): Promise<Result<CircuitBreakers>> { return getJson('/circuit-breaker') }
export function getTelemetryDistributions(lookbackDays = 30): Promise<Result<TelemetryDistributions>> {
  return getJson(`/telemetry/distributions?lookback_days=${lookbackDays}`)
}

// ─── Trading diagnostics ────────────────────────────────────────────
// Mirrors the engine's TradingDiagnostics shape. `unknown` permeates
// the sub-sections because each one can degrade independently to an
// "available: false" marker.

export interface TradingDiagnostics {
  generated_at: string
  engine: {
    signal_engine_enabled: boolean
    signal_dry_run:        boolean
    symbols:               string[]
    symbol_count:          number
    timeframe:             string
    scan_interval_min:     number
    min_confidence:        number
    max_active_per_symbol: number
    has_supabase:          boolean
    has_market_data:       boolean
  }
  bars: {
    available?: boolean; note?: string
    fresh?: number; stale?: number; critical?: number; never_scanned?: number
    symbols?: Array<{
      symbol: string; status: string; last_regime: string | null
      scanned_at: string | null; age_seconds: number | null
    }>
  }
  institutional_risk: {
    available?: boolean; reason?: string
    state?: string; locked?: boolean; locked_reason?: string
    kill_switch_active?: boolean; cooldown_until?: string | null
    open_positions?: number
    open_positions_by_symbol?: Record<string, number>
    current_equity?: number
    daily_drawdown_pct?: number; weekly_drawdown_pct?: number; total_drawdown_pct?: number
    consecutive_losses?: number
    broker_connected?: boolean
    limits?: Record<string, number>
  }
  circuit_breakers: {
    available?: boolean; reason?: string
    open_count?: number
    symbols?: Record<string, {
      is_open: boolean; reason: string
      consecutive_losses: number; daily_losses: number
    }>
  }
  active_signals: {
    available?: boolean; note?: string
    max_active_per_symbol?: number
    starved_symbols?: number
    total_active_algo?: number; total_active_manual?: number
    symbols?: Array<{
      symbol: string
      active: number      // engine_version='algo_v1' only — the one that gates
      manual: number      // engine_version='manual' — surfaced for context, no gating effect
      starved: boolean
      oldest_open: string | null
    }>
  }
  last_signal_seen: {
    available?: boolean; note?: string; age_seconds?: number | null
    last_signal?: { id: string; pair: string; direction: string
      confidence_score: number | null; regime: string | null
      published_at: string } | null
  }
  rejection_trace_tail: {
    available: boolean; path?: string; note?: string
    tail_count?: number
    rejection_breakdown?: Record<string, number>
    rows?: Array<Record<string, unknown>>
  }
  summary: {
    verdict:  string
    suspects: string[]
  }
}

export function getTradingDiagnostics(): Promise<Result<TradingDiagnostics>> {
  return getJson('/diagnostics/trading')
}


// ─── Write endpoints (engine key required) ──────────────────────────

export interface BrokerTestResult {
  state:       'pending' | 'testing' | 'connected' | 'failed' | 'disabled' | 'revoked'
  reason:      string | null
  equity_usd:  number | null
  checked_at:  string
  latency_ms:  number
}

/**
 * Synchronous broker handshake. Calls /api/v1/brokers/test on the
 * engine; the engine attempts the round-trip and persists the result
 * to broker_connections before returning. The web /api/brokers POST
 * + /api/brokers/[id]/test routes both call this so the user gets an
 * immediate verdict — no 10-minute pending limbo.
 *
 * Per-broker timeout: crypto venues (Binance/Bybit/OKX) handshake in
 * 1–5s. MT5 routes through the Windows bridge which re-logs the
 * terminal per call (10–25s cold-start) and serialises via a global
 * lock, so we give it a much wider window. The engine itself has no
 * upstream timeout — only the web → engine HTTP edge is bounded.
 */
const TEST_TIMEOUT_MS: Record<string, number> = {
  mt5:      45_000,
  ctrader:  45_000,
  oanda:    30_000,
  tradovate:30_000,
}
const TEST_TIMEOUT_DEFAULT_MS = 20_000

export async function testBrokerConnection(
  userId: string,
  broker: string,
): Promise<Result<BrokerTestResult>> {
  const base = engineBase()
  if (!base) return { ok: false, error: 'SIGNAL_ENGINE_URL not configured' }
  const key = process.env.ENGINE_API_KEY ?? ''

  const ctrl = new AbortController()
  const timer = setTimeout(
    () => ctrl.abort(),
    TEST_TIMEOUT_MS[broker.toLowerCase()] ?? TEST_TIMEOUT_DEFAULT_MS,
  )
  try {
    const res = await fetch(`${base}/api/v1/brokers/test`, {
      method:  'POST',
      signal:  ctrl.signal,
      headers: {
        'content-type':  'application/json',
        'accept':        'application/json',
        ...(key ? { 'x-engine-key': key } : {}),
      },
      body: JSON.stringify({ user_id: userId, broker }),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: false, error: `engine /brokers/test → HTTP ${res.status}` }
    }
    const data = (await res.json()) as BrokerTestResult
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? 'timeout' : e.message)
      : 'fetch failed'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
