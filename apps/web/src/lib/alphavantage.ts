/**
 * Alpha Vantage client — fundamentals + macro intelligence layer.
 *
 * Per the institutional data architecture:
 *   Massive/Polygon = FAST layer (real-time prices, candles, ticks)
 *   Alpha Vantage   = SLOW intelligence layer (fundamentals, macro,
 *                     economic context, indicator enrichment)
 *
 * This module is the AV side: typed access to the macro indicators
 * the market-intelligence narrative needs. We deliberately do NOT
 * use AV for OHLCV anymore (the free tier's ~25 req/day cap is too
 * tight for ongoing bar fetches, and it duplicates Polygon's role).
 *
 * Caching: every call goes through Next's fetch cache with a 6-hour
 * revalidate. Macro indicators update monthly/quarterly so a single
 * snapshot poll comfortably serves the whole user base from cache.
 */

const BASE = 'https://www.alphavantage.co/query'

export function isAlphaVantageConfigured(): boolean {
  return typeof process.env.ALPHA_VANTAGE_API_KEY === 'string'
      && process.env.ALPHA_VANTAGE_API_KEY.length > 8
}

export class AlphaVantageError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number) {
    super(message)
    this.name = 'AlphaVantageError'
  }
}

interface SeriesPoint { date: string; value: number }
interface SeriesResponse {
  name?:     string
  interval?: string
  unit?:     string
  data?:     Array<{ date: string; value: string }>
  /** AV returns these on rate-limit / free-tier-exhaustion. */
  'Note'?:        string
  'Information'?: string
  'Error Message'?: string
}

/**
 * Generic AV series fetch. Returns the most recent N points (newest first).
 * Throws on missing key / network / API rate-limit messages.
 */
async function fetchSeries(
  fn: string, extra: Record<string, string> = {}, take = 24,
): Promise<{ name: string; unit: string; interval: string; points: SeriesPoint[] }> {
  const key = process.env.ALPHA_VANTAGE_API_KEY
  if (!key) throw new AlphaVantageError('ALPHA_VANTAGE_API_KEY not configured', 'no_key')

  const params = new URLSearchParams({ function: fn, apikey: key, datatype: 'json', ...extra })
  const url    = `${BASE}?${params.toString()}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 12_000)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      // Six-hour cache — macro indicators move monthly/quarterly so we
      // serve every user from cache after the first hit. Keeps daily AV
      // burn at <10 even with traffic.
      next: { revalidate: 6 * 60 * 60 },
    })
    if (!res.ok) {
      throw new AlphaVantageError(`AV ${res.status}: ${(await res.text()).slice(0, 200)}`, 'http_error', res.status)
    }
    const json = (await res.json()) as SeriesResponse
    const apiMsg = json.Note || json.Information || json['Error Message']
    if (apiMsg) {
      // Free tier rate-limit notices arrive as 200-OK with a Note/Information field.
      throw new AlphaVantageError(`AV rate-limited or refused: ${apiMsg.slice(0, 180)}`, 'rate_limited')
    }
    const points: SeriesPoint[] = (json.data ?? [])
      .slice(0, take)
      .map((p) => ({ date: p.date, value: Number(p.value) }))
      .filter((p) => Number.isFinite(p.value))
    return {
      name:     json.name     ?? fn,
      unit:     json.unit     ?? '',
      interval: json.interval ?? '',
      points,
    }
  } catch (e) {
    if (e instanceof AlphaVantageError) throw e
    if ((e as Error)?.name === 'AbortError') throw new AlphaVantageError('AV request timed out', 'timeout')
    throw new AlphaVantageError((e as Error)?.message ?? 'AV request failed', 'fetch_error')
  } finally {
    clearTimeout(timer)
  }
}

// ── Individual indicators ────────────────────────────────────────────────

export const getCPI               = () => fetchSeries('CPI',                 { interval: 'monthly' })
export const getRealGDP           = () => fetchSeries('REAL_GDP',            { interval: 'quarterly' })
export const getTreasuryYield10Y  = () => fetchSeries('TREASURY_YIELD',      { interval: 'monthly', maturity: '10year' })
export const getFederalFundsRate  = () => fetchSeries('FEDERAL_FUNDS_RATE',  { interval: 'monthly' })

// ── Macro snapshot — one call powers the whole macro panel ─────────────

export interface MacroIndicator {
  key:         'inflation_yoy' | 'real_gdp_yoy' | 'treasury_10y' | 'fed_funds_rate'
  label:       string
  unit:        string
  latest:      number          // most recent reading
  latest_date: string          // ISO date of latest reading
  yoy_change:  number | null   // year-over-year change (pct points or pct depending on indicator)
  trend:       'rising' | 'falling' | 'stable'
  /** True when the series came back but YoY couldn't be derived (insufficient history). */
  partial:     boolean
}

export interface MacroSnapshot {
  indicators:  MacroIndicator[]
  fetched_at:  string
  /** True when at least one indicator failed (typically rate-limit on free tier). */
  partial:     boolean
  errors:      Array<{ key: string; reason: string }>
}

/** Year-over-year change in percentage points for index series, or % for rate series. */
function deriveYoY(points: SeriesPoint[], kind: 'pct_points' | 'pct'): number | null {
  if (points.length < 12) return null
  const newest = points[0]?.value
  // For monthly series take the value ~12 months back. Walk by index; AV
  // returns newest-first so points[12] is roughly one year back.
  const yearAgo = points[12]?.value
  if (!Number.isFinite(newest) || !Number.isFinite(yearAgo) || yearAgo === 0) return null
  return kind === 'pct_points'
    ? Number((newest! - yearAgo!).toFixed(2))
    : Number((((newest! - yearAgo!) / yearAgo!) * 100).toFixed(2))
}

function trendOf(points: SeriesPoint[]): 'rising' | 'falling' | 'stable' {
  if (points.length < 3) return 'stable'
  const newest = points[0]?.value ?? 0
  const prior  = points[2]?.value ?? newest   // two periods back
  const delta  = newest - prior
  if (Math.abs(delta) < 1e-6) return 'stable'
  return delta > 0 ? 'rising' : 'falling'
}

/** Fetches all four indicators in parallel; failures degrade gracefully —
 *  one indicator hitting AV's rate limit doesn't kill the whole snapshot. */
export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const calls = [
    { key: 'inflation_yoy' as const,  label: 'Inflation (CPI YoY)',        unit: '%',   kind: 'pct'        as const, run: getCPI },
    { key: 'real_gdp_yoy' as const,   label: 'Real GDP (YoY)',             unit: '%',   kind: 'pct'        as const, run: getRealGDP },
    { key: 'treasury_10y' as const,   label: '10-Year Treasury Yield',     unit: '%',   kind: 'pct_points' as const, run: getTreasuryYield10Y },
    { key: 'fed_funds_rate' as const, label: 'Federal Funds Rate',         unit: '%',   kind: 'pct_points' as const, run: getFederalFundsRate },
  ]

  const results = await Promise.allSettled(calls.map((c) => c.run()))
  const indicators: MacroIndicator[] = []
  const errors: Array<{ key: string; reason: string }> = []

  results.forEach((r, i) => {
    const c = calls[i]!
    if (r.status === 'fulfilled' && r.value.points[0]) {
      const yoy = deriveYoY(r.value.points, c.kind)
      indicators.push({
        key:         c.key,
        label:       c.label,
        unit:        c.unit,
        latest:      r.value.points[0]!.value,
        latest_date: r.value.points[0]!.date,
        yoy_change:  yoy,
        trend:       trendOf(r.value.points),
        partial:     yoy === null,
      })
    } else {
      const reason = r.status === 'rejected' ? (r.reason as Error)?.message ?? 'unknown' : 'no data'
      errors.push({ key: c.key, reason: String(reason).slice(0, 160) })
    }
  })

  return {
    indicators,
    fetched_at: new Date().toISOString(),
    partial:    errors.length > 0,
    errors,
  }
}
