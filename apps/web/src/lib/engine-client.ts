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

export function getEngineStatus():   Promise<Result<EngineStatus>>   { return getJson('/status') }
export function getRiskTelemetry():  Promise<Result<RiskTelemetry>>  { return getJson('/risk/telemetry') }
export function getCircuitBreakers(): Promise<Result<CircuitBreakers>> { return getJson('/circuit-breaker') }


// ─── Historical OHLCV (for /backtest real-data mode) ────────────────

export interface OhlcvBar {
  time:   number   // unix epoch seconds
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export interface OhlcvResponse {
  symbol:   string
  interval: string
  bars:     OhlcvBar[]
  /** Engine returns this when no provider key is configured. */
  provider?: string
  /** Engine returns this when the provider call threw. */
  error?:   string
}

/**
 * Fetch historical bars from the engine for the backtester. The engine
 * itself degrades to `{ bars: [] }` when no provider is configured, so
 * callers should still handle the empty-bars case as a soft state, not
 * an error.
 *
 * `interval` accepts the engine's TwelveData-style format:
 *   '1min' | '5min' | '15min' | '30min' | '45min' | '1h' | '2h' | '4h' | '1day' | '1week'
 */
export function getOhlcv(
  symbol:    string,
  interval:  string,
  outputsize = 500,
): Promise<Result<OhlcvResponse>> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
  })
  return getJson(`/ohlcv?${qs.toString()}`)
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
 * Longer timeout (20s) than reads: the actual handshake to Binance /
 * Bybit / OKX can take a few seconds, especially on a cold engine.
 */
export async function testBrokerConnection(
  userId: string,
  broker: string,
): Promise<Result<BrokerTestResult>> {
  const base = engineBase()
  if (!base) return { ok: false, error: 'SIGNAL_ENGINE_URL not configured' }
  const key = process.env.ENGINE_API_KEY ?? ''

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
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


// ─── Manual order execution ─────────────────────────────────────────

/**
 * One order, placed by the user from a signal card via /api/trade/execute.
 *
 * The order is NOT placed here — the web layer never touches a broker
 * directly. We hand the request to the signal-engine (the only service
 * that can decrypt broker credentials and that owns the 12–15 gate risk
 * firewall), authenticated with X-Engine-Key. The engine runs its
 * preflight gates and either fills or refuses; we relay its verdict.
 *
 * Fail-closed by construction: if the engine URL or key is missing, or
 * the engine is unreachable / returns non-2xx, we return `ok: false` and
 * the caller surfaces an honest error. We NEVER report a placed trade we
 * cannot confirm.
 *
 * Contract — matches the engine's `POST /api/v1/execute` (api/execute.py:
 * ExecuteIn → ExecuteOut). The engine resolves the broker adapter from
 * (user_id, broker) against broker_connections + vault, so we send the
 * user id and broker name, NOT a connection id.
 */
export interface ManualOrderRequest {
  user_id:          string
  broker:           string
  symbol:           string
  side:             'buy' | 'sell'
  quantity:         number
  stop_loss:        number | null
  take_profit:      number | null
  /** Stable id so a double-submit can't double-fill (engine dedups on it). */
  client_order_id:  string
}

/** Mirrors the engine's ExecuteOut. `ok` is the trade outcome (filled vs
 *  rejected); a transport failure is reported via the Result wrapper. */
export interface ManualOrderResult {
  ok:             boolean
  order_id:       string | null
  status:         string | null
  filled_qty:     number
  avg_fill_price: number
  slippage_pct:   number
  error:          string | null
  broker:         string
  testnet:        boolean
}

export async function executeManualOrder(
  req: ManualOrderRequest,
): Promise<Result<ManualOrderResult>> {
  const base = engineBase()
  if (!base) return { ok: false, error: 'execution unavailable: SIGNAL_ENGINE_URL not configured' }
  const key = process.env.ENGINE_API_KEY ?? ''
  if (!key) return { ok: false, error: 'execution unavailable: engine key not configured' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(`${base}/api/v1/execute`, {
      method:  'POST',
      signal:  ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'accept':       'application/json',
        'x-engine-key': key,
      },
      body: JSON.stringify({
        broker:      req.broker,
        symbol:      req.symbol,
        side:        req.side,
        order_type:  'market',
        quantity:    req.quantity,
        stop_loss:   req.stop_loss ?? undefined,
        take_profit: req.take_profit ?? undefined,
        client_order_id: req.client_order_id,
        reduce_only: false,
        user_id:     req.user_id,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      // Transport/validation/auth failure (e.g. 403 bad key, 422, 503 no
      // adapter). Surface the engine's detail when present; never throw.
      let detail = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { detail?: string; error?: string }
        detail = body.detail ?? body.error ?? detail
      } catch { /* non-JSON body — keep HTTP status */ }
      return { ok: false, error: detail }
    }
    // 200 with ExecuteOut — note ExecuteOut.ok may be false (kill switch,
    // rejection, slippage veto); that's a trade outcome, not a transport error.
    const data = (await res.json()) as ManualOrderResult
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? 'engine timeout — order not confirmed' : e.message)
      : 'fetch failed'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
