/**
 * GET /api/market/narrative — cross-asset regime summary.
 *
 * Classifies the environment into risk_on / risk_off / volatile /
 * trend_expansion / ranging from today's % moves across BTC, S&P 500,
 * NASDAQ 100, DXY, Gold and VIX. Rule-based — no AI inference, no hidden
 * model output; the frontend gets only the regime + a one-line summary +
 * the signal % moves.
 *
 * DATA SOURCING (matters — Vercel runs in a US region):
 *   • Crypto → Coinbase Exchange REST. Binance REST 451s US IPs, so the
 *     server can't use it; Coinbase is US-domiciled and works.
 *   • Equities/DXY/VIX → Finnhub /quote on liquid ETF proxies (SPY, QQQ,
 *     UUP, VIXY) — free real-time, US-listed. ETF % move ≈ index % move,
 *     which is all the regime classifier needs.
 *   • Gold → Finnhub GLD proxy.
 * Honest coverage flag (full / crypto-only / partial) — never fabricates
 * a regime when a feed is down or unkeyed.
 */
import { NextResponse } from 'next/server'
import { getQuotes as finnhubQuotes, isFinnhubConfigured } from '@/lib/quotes/finnhub'

export const dynamic = 'force-dynamic'

export type Regime =
  'risk_on' | 'risk_off' | 'volatile' | 'trend_expansion' | 'ranging' | 'unknown'

interface Signal {
  symbol:   string
  price:    number | null
  pct_24h:  number | null
  provider: 'coinbase' | 'finnhub'
}

interface NarrativeResponse {
  regime:       Regime
  label:        string
  summary:      string
  signals:      Signal[]
  coverage:     'full' | 'partial' | 'crypto-only'
  generated_at: string
}

// Index/FX/vol exposed through liquid ETF proxies on Finnhub.
const PROXY: Record<string, string> = { SPX: 'SPY', NDX: 'QQQ', DXY: 'UUP', VIX: 'VIXY', 'XAU/USD': 'GLD' }

async function coinbaseStat(product: string, label: string): Promise<Signal> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${product}/stats`, {
      headers: { 'User-Agent': 'algosphere' }, next: { revalidate: 60 },
    })
    if (!r.ok) throw new Error(`coinbase ${r.status}`)
    const j = (await r.json()) as { open?: string; last?: string }
    const open = j.open ? parseFloat(j.open) : null
    const last = j.last ? parseFloat(j.last) : null
    const pct  = open && last && open > 0 ? ((last - open) / open) * 100 : null
    return { symbol: label, provider: 'coinbase', price: last, pct_24h: pct }
  } catch {
    return { symbol: label, provider: 'coinbase', price: null, pct_24h: null }
  }
}

async function fetchSignals(): Promise<Signal[]> {
  const btcP = coinbaseStat('BTC-USD', 'BTC')

  let proxyMap = new Map<string, { price: number; changePct: number }>()
  if (isFinnhubConfigured()) {
    try { proxyMap = await finnhubQuotes(Object.values(PROXY)) } catch { /* honest empties below */ }
  }
  const fromProxy = (sym: string): Signal => {
    const q = proxyMap.get(PROXY[sym]!)
    return { symbol: sym, provider: 'finnhub', price: q?.price ?? null, pct_24h: q?.changePct ?? null }
  }

  const btc = await btcP
  return [btc, fromProxy('SPX'), fromProxy('NDX'), fromProxy('DXY'), fromProxy('XAU/USD'), fromProxy('VIX')]
}

function classify(signals: Signal[]): NarrativeResponse {
  const get = (s: string) => signals.find((x) => x.symbol === s)
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const fmt = (v: number | null, d = 2) => (v === null ? '?' : v.toFixed(d))

  const btc  = get('BTC')
  const spx  = get('SPX'); const ndx = get('NDX')
  const dxy  = get('DXY'); const gold = get('XAU/USD'); const vix = get('VIX')

  const btcLive = num(btc?.pct_24h ?? null) !== null
  const tdLive  = [spx, ndx, dxy, gold, vix].some((s) => num(s?.pct_24h ?? null) !== null)
  const coverage: NarrativeResponse['coverage'] =
    btcLive && tdLive ? 'full' : btcLive ? 'crypto-only' : 'partial'

  if (coverage === 'crypto-only') {
    const c = num(btc?.pct_24h ?? null) ?? 0
    const regime: Regime = Math.abs(c) >= 4 ? 'trend_expansion' : 'ranging'
    return {
      regime,
      label: regime === 'trend_expansion' ? 'Trend Expansion (crypto)' : 'Ranging (crypto)',
      summary: `Only BTC ${fmt(c)}% available (equity/FX proxy feed not configured) — full cross-asset regime can't be assessed.`,
      signals, coverage, generated_at: new Date().toISOString(),
    }
  }
  if (coverage === 'partial') {
    return {
      regime: 'unknown', label: 'Unknown',
      summary: 'Market data feed unreachable — regime can\'t be classified.',
      signals, coverage, generated_at: new Date().toISOString(),
    }
  }

  const vixPct  = num(vix?.pct_24h ?? null) ?? 0
  const spxPct  = num(spx?.pct_24h ?? null) ?? 0
  const ndxPct  = num(ndx?.pct_24h ?? null) ?? 0
  const dxyPct  = num(dxy?.pct_24h ?? null) ?? 0
  const goldPct = num(gold?.pct_24h ?? null) ?? 0
  const btcPct  = num(btc?.pct_24h ?? null) ?? 0
  const eqAvg   = (spxPct + ndxPct) / 2

  let regime: Regime; let label: string; let summary: string

  // VIXY (the proxy) tracks VIX-futures direction, not the VIX level, so we
  // trigger 'volatile' on a sharp spike rather than an absolute threshold.
  if (vixPct >= 8) {
    regime = 'volatile'; label = 'Volatile'
    summary = `Volatility bid — VIX proxy +${fmt(vixPct, 1)}%. Tighter risk, wider stops, expect intraday whipsaw.`
  } else if (eqAvg > 0.4 && btcPct > 1 && dxyPct < 0.2) {
    regime = 'risk_on'; label = 'Risk-On'
    summary = `Equities up (S&P ${fmt(spxPct)}%, NDX ${fmt(ndxPct)}%), BTC ${fmt(btcPct)}%, USD ${fmt(dxyPct)}%. Pro-risk — momentum & breakout setups favoured.`
  } else if (eqAvg < -0.4 && btcPct < -1 && (goldPct > 0 || dxyPct > 0)) {
    regime = 'risk_off'; label = 'Risk-Off'
    summary = `Equities down (S&P ${fmt(spxPct)}%, NDX ${fmt(ndxPct)}%), BTC ${fmt(btcPct)}%; Gold ${fmt(goldPct)}%, USD ${fmt(dxyPct)}% bid. Defensive — fade strength.`
  } else if (Math.abs(eqAvg) > 1.2 || Math.abs(btcPct) > 3) {
    regime = 'trend_expansion'; label = 'Trend Expansion'
    summary = `Directional moves dominating — equities ${fmt(eqAvg)}%, BTC ${fmt(btcPct)}%. Trend-following over mean-reversion.`
  } else {
    regime = 'ranging'; label = 'Ranging'
    summary = `Muted cross-asset moves — equities ${fmt(eqAvg)}%, BTC ${fmt(btcPct)}%. Mean-reversion regime; size down on breakouts.`
  }

  return { regime, label, summary, signals, coverage, generated_at: new Date().toISOString() }
}

export async function GET() {
  const payload = classify(await fetchSignals())
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
