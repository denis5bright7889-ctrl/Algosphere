/**
 * GET /api/market/narrative — cross-asset regime summary.
 *
 * Fetches today's % moves for a curated set of cross-asset signals
 * (BTC, S&P 500, NASDAQ 100, DXY, Gold, VIX) and classifies the
 * environment into one of: risk_on, risk_off, volatile, trend_expansion,
 * ranging. Rule-based — no AI inference, no hidden model output. The
 * frontend gets only the final regime + a one-line summary + the signals.
 *
 * Upstream fetches use Next's revalidate cache so concurrent page loads
 * don't multiply API calls — Binance is keyless; Twelve Data is gated on
 * TWELVE_DATA_API_KEY (missing key → we still classify from BTC alone
 * and label the result honestly).
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TD_BATCH = ['SPX', 'NDX', 'DXY', 'XAU/USD', 'VIX'] as const
type TdSym = (typeof TD_BATCH)[number]

export type Regime =
  'risk_on' | 'risk_off' | 'volatile' | 'trend_expansion' | 'ranging' | 'unknown'

interface Signal {
  symbol:    string
  price:     number | null
  pct_24h:   number | null
  provider:  'binance' | 'twelvedata'
}

interface NarrativeResponse {
  regime:        Regime
  label:         string
  summary:       string
  signals:       Signal[]
  coverage:      'full' | 'partial' | 'crypto-only'
  generated_at:  string
}

// ── Upstream fetches (Next dedups via revalidate cache) ────────────────

async function fetchBTC(): Promise<Signal> {
  try {
    const r = await fetch(
      'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
      { next: { revalidate: 60 } },
    )
    if (!r.ok) throw new Error(`binance ${r.status}`)
    const j = (await r.json()) as { lastPrice?: string; priceChangePercent?: string }
    return {
      symbol: 'BTC', provider: 'binance',
      price:   j.lastPrice ? parseFloat(j.lastPrice) : null,
      pct_24h: j.priceChangePercent ? parseFloat(j.priceChangePercent) : null,
    }
  } catch {
    return { symbol: 'BTC', provider: 'binance', price: null, pct_24h: null }
  }
}

interface TdQuote { symbol?: string; close?: string; percent_change?: string }

async function fetchTD(): Promise<Signal[]> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return TD_BATCH.map((s) => emptyTD(s))
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(TD_BATCH.join(','))}&apikey=${key}`
    const r = await fetch(url, { next: { revalidate: 300 } })
    if (!r.ok) throw new Error(`twelvedata ${r.status}`)
    const j = (await r.json()) as Record<string, TdQuote> | TdQuote
    // /quote with multiple symbols returns a keyed dict; single returns flat.
    const dict: Record<string, TdQuote> = 'symbol' in j
      ? { [(j as TdQuote).symbol ?? '']: j as TdQuote }
      : (j as Record<string, TdQuote>)
    return TD_BATCH.map((s) => {
      const q = dict[s]
      if (!q || !q.close) return emptyTD(s)
      return {
        symbol:   s, provider: 'twelvedata',
        price:    parseFloat(q.close),
        pct_24h:  q.percent_change != null ? parseFloat(q.percent_change) : null,
      } as Signal
    })
  } catch {
    return TD_BATCH.map((s) => emptyTD(s))
  }
}

function emptyTD(s: TdSym): Signal {
  return { symbol: s, provider: 'twelvedata', price: null, pct_24h: null }
}

// ── Rule-based regime classifier ───────────────────────────────────────

function classify(signals: Signal[]): NarrativeResponse {
  const get  = (s: string) => signals.find((x) => x.symbol === s)
  const num  = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const fmt  = (v: number | null, digits = 2) => (v === null ? '?' : v.toFixed(digits))

  const btc  = get('BTC')
  const spx  = get('SPX')
  const ndx  = get('NDX')
  const dxy  = get('DXY')
  const gold = get('XAU/USD')
  const vix  = get('VIX')

  // Coverage — be honest about what we know.
  const tdLive = [spx, ndx, dxy, gold, vix].some((s) => num(s?.pct_24h ?? null) !== null)
  const btcLive = num(btc?.pct_24h ?? null) !== null
  const coverage: NarrativeResponse['coverage'] =
    tdLive && btcLive ? 'full' : btcLive ? 'crypto-only' : 'partial'

  // Crypto-only fallback: no TD key / down.
  if (coverage === 'crypto-only') {
    const c = num(btc?.pct_24h ?? null) ?? 0
    const regime: Regime = Math.abs(c) >= 4 ? 'trend_expansion' : Math.abs(c) >= 1 ? 'ranging' : 'ranging'
    return {
      regime,
      label: regime === 'trend_expansion' ? 'Trend Expansion (crypto)' : 'Ranging (crypto)',
      summary: `Only BTC ${fmt(c)}% available (Twelve Data key not configured) — cross-asset regime can't be assessed.`,
      signals, coverage,
      generated_at: new Date().toISOString(),
    }
  }
  if (coverage === 'partial') {
    return {
      regime: 'unknown', label: 'Unknown',
      summary: 'Market data feed unreachable — regime can\'t be classified.',
      signals, coverage,
      generated_at: new Date().toISOString(),
    }
  }

  const vixPrice  = num(vix?.price   ?? null)
  const vixPct    = num(vix?.pct_24h ?? null) ?? 0
  const spxPct    = num(spx?.pct_24h ?? null) ?? 0
  const ndxPct    = num(ndx?.pct_24h ?? null) ?? 0
  const dxyPct    = num(dxy?.pct_24h ?? null) ?? 0
  const goldPct   = num(gold?.pct_24h ?? null) ?? 0
  const btcPct    = num(btc?.pct_24h ?? null) ?? 0
  const eqAvg     = (spxPct + ndxPct) / 2

  let regime: Regime; let label: string; let summary: string

  if ((vixPrice !== null && vixPrice >= 25) || vixPct >= 10) {
    regime = 'volatile'; label = 'Volatile'
    summary = `VIX ${fmt(vixPrice, 1)}${vixPct >= 10 ? ` (+${fmt(vixPct, 1)}%)` : ''} — elevated volatility. Tighter risk; wider stops; expect intraday whipsaw.`
  } else if (eqAvg > 0.5 && btcPct > 1 && dxyPct < 0) {
    regime = 'risk_on'; label = 'Risk-On'
    summary = `Equities up (S&P ${fmt(spxPct)}%, NDX ${fmt(ndxPct)}%), BTC ${fmt(btcPct)}%, DXY ${fmt(dxyPct)}%. Pro-risk regime — momentum & breakout setups favoured.`
  } else if (eqAvg < -0.5 && btcPct < -1 && (goldPct > 0 || dxyPct > 0)) {
    regime = 'risk_off'; label = 'Risk-Off'
    summary = `Equities down (S&P ${fmt(spxPct)}%, NDX ${fmt(ndxPct)}%), BTC ${fmt(btcPct)}%, Gold ${fmt(goldPct)}%, DXY ${fmt(dxyPct)}%. Defensive regime — fade strength, prefer reduce-only.`
  } else if (Math.abs(eqAvg) > 1.5 || Math.abs(btcPct) > 3) {
    regime = 'trend_expansion'; label = 'Trend Expansion'
    summary = `Directional moves dominating — equities ${fmt(eqAvg)}%, BTC ${fmt(btcPct)}%. Trend-following over mean-reversion.`
  } else {
    regime = 'ranging'; label = 'Ranging'
    summary = `Muted cross-asset moves — equities ${fmt(eqAvg)}%, BTC ${fmt(btcPct)}%, VIX ${fmt(vixPrice, 1)}. Mean-reversion regime; size down on breakouts.`
  }

  return { regime, label, summary, signals, coverage, generated_at: new Date().toISOString() }
}

export async function GET() {
  const [btc, td] = await Promise.all([fetchBTC(), fetchTD()])
  const payload = classify([btc, ...td])
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
