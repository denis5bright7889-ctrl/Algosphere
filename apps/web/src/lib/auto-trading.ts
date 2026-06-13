/**
 * Auto-trading settings shape + the pure shouldAutoExecute() gate.
 *
 * The gate is consumed by:
 *   - the AutoTradingPanel UI (live "would this signal qualify?" hint)
 *   - the future auto-executor cron (server-side enforcement)
 *
 * Both call the same function so the UI preview matches what the cron
 * will actually do.
 */

export interface AutoTradingSettings {
  user_id:                  string
  enabled:                  boolean
  allowed_symbols:          string[]
  min_confidence:           number
  max_risk_pct:             number
  max_trades_per_day:       number
  allowed_directions:       string[]
  allowed_brokers:          string[]
  require_active_session:   boolean
  paused_until:             string | null
  updated_at:               string
  enabled_at:               string | null
  total_auto_executions:    number
}

export const DEFAULT_SETTINGS: Omit<AutoTradingSettings, 'user_id' | 'updated_at' | 'enabled_at' | 'total_auto_executions'> = {
  enabled:                false,
  allowed_symbols:        [],
  min_confidence:         80,
  max_risk_pct:           1.0,
  max_trades_per_day:     5,
  allowed_directions:     ['buy', 'sell'],
  allowed_brokers:        [],
  require_active_session: true,
  paused_until:           null,
}

export interface SignalForGate {
  pair:               string
  direction:          string
  confidence_score:   number | null
  session?:           string | null
}

export interface BrokerForGate {
  broker:    string
  status:    string
}

export interface GateResult {
  allowed:  boolean
  reasons:  string[]      // empty when allowed; one entry per failed gate when not
}

/**
 * Pure gate — same input always returns same output. Returns
 * { allowed: true, reasons: [] } only when ALL gates pass.
 */
export function shouldAutoExecute(
  signal:           SignalForGate,
  settings:         AutoTradingSettings | null,
  brokers:          BrokerForGate[],
  tradesToday:      number,
  now: Date = new Date(),
): GateResult {
  const reasons: string[] = []

  if (!settings)                  return { allowed: false, reasons: ['Auto-trading not configured'] }
  if (!settings.enabled)          reasons.push('Auto-trading disabled')

  if (settings.paused_until && new Date(settings.paused_until).getTime() > now.getTime()) {
    reasons.push(`Paused until ${new Date(settings.paused_until).toISOString().slice(0, 16)}`)
  }

  const connectedBrokers = brokers.filter(b => b.status === 'connected')
  if (connectedBrokers.length === 0) {
    reasons.push('No connected broker')
  } else if (settings.allowed_brokers.length > 0) {
    const allowed = connectedBrokers.some(b => settings.allowed_brokers.includes(b.broker))
    if (!allowed) reasons.push(`No connected broker matches allow-list (${settings.allowed_brokers.join(', ')})`)
  }

  if (settings.allowed_symbols.length === 0) {
    reasons.push('No allowed symbols configured')
  } else if (!settings.allowed_symbols.includes(signal.pair)) {
    reasons.push(`${signal.pair} not in allowed symbols`)
  }

  if (!settings.allowed_directions.includes(signal.direction)) {
    reasons.push(`Direction ${signal.direction} not allowed`)
  }

  const conf = signal.confidence_score ?? 0
  if (conf < settings.min_confidence) {
    reasons.push(`Confidence ${conf}% < ${settings.min_confidence}% threshold`)
  }

  if (tradesToday >= settings.max_trades_per_day) {
    reasons.push(`Daily cap reached (${tradesToday}/${settings.max_trades_per_day})`)
  }

  if (settings.require_active_session) {
    const sess = signal.session ?? ''
    const ok = sess === 'london' || sess === 'new_york' || sess === 'overlap'
    if (!ok) reasons.push(`Outside active session (${sess || 'unknown'})`)
  }

  return { allowed: reasons.length === 0, reasons }
}

export const SUPPORTED_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'USDCHF', 'USDCAD',
  'XAUUSD', 'XAGUSD',
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
] as const
