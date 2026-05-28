/**
 * GET /api/live-state — the persistent right-panel feed.
 *
 * Deliberately CHEAP: four RLS-scoped Supabase reads, NO engine runs (the
 * heavy intelligence composers stay on their own pages). Powers the
 * always-on Live State Panel — market regime/bias, the user's risk
 * snapshot, broker connection state, and the live signal feed. Polls
 * cheaply every ~20s.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [regimeRes, brokersRes, expRes, signalsRes] = await Promise.all([
    supabase.from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .order('scanned_at', { ascending: false }).limit(30),
    supabase.from('broker_connections')
      .select('broker, status, is_live, is_testnet')
      .eq('user_id', user.id),
    supabase.from('portfolio_exposure')
      .select('total_notional, open_positions, daily_realized_pnl, drawdown_usd, largest_concentration_pct')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('signals')
      .select('id, pair, direction, status, published_at')
      .eq('status', 'active')
      .order('published_at', { ascending: false }).limit(6),
  ])

  // ── Market regime + bias (dedup latest row per symbol) ──────────────
  const seen = new Set<string>()
  const latest = (regimeRes.data ?? []).filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
  let up = 0, down = 0, ranging = 0
  for (const r of latest) {
    const g = (r.regime ?? '').toLowerCase()
    if (g.includes('up') || g.includes('bull')) up++
    else if (g.includes('down') || g.includes('bear')) down++
    else if (g.includes('range') || g.includes('chop') || g.includes('neutral')) ranging++
  }
  const total = latest.length
  const bias: 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed' | 'Unknown' =
    total === 0 ? 'Unknown'
    : up > down && up > ranging ? 'Bullish'
    : down > up && down > ranging ? 'Bearish'
    : ranging >= up && ranging >= down ? 'Neutral'
    : 'Mixed'
  const regimeLabel: 'Trending' | 'Ranging' | 'Volatile' | 'Unknown' =
    total === 0 ? 'Unknown'
    : (up + down) > ranging ? 'Trending'
    : ranging > 0 ? 'Ranging'
    : 'Volatile'

  // ── Broker state ────────────────────────────────────────────────────
  const conns = brokersRes.data ?? []
  const errored    = conns.find((b) => b.status === 'error')
  const liveBroker = conns.find((b) => b.status === 'connected' && b.is_live === true && b.is_testnet !== true)
  const connected  = conns.find((b) => b.status === 'connected')
  const broker =
    errored     ? { state: 'error',     label: 'Connection error', broker: cap(errored.broker), mode: null }
    : liveBroker ? { state: 'live',      label: 'Live',              broker: cap(liveBroker.broker), mode: 'live' as const }
    : connected  ? { state: 'testnet',   label: 'Testnet',           broker: cap(connected.broker), mode: 'demo' as const }
    :              { state: 'none',      label: 'Not connected',     broker: null, mode: null }

  // ── Risk snapshot ─────────────────────────────────────────────────────
  const exp = expRes.data ?? null

  return NextResponse.json({
    market: { regime: regimeLabel, bias, scanned: total },
    risk: {
      totalNotional:  num(exp?.total_notional),
      openPositions:  num(exp?.open_positions),
      dailyPnl:       num(exp?.daily_realized_pnl),
      drawdownUsd:    num(exp?.drawdown_usd),
      concentration:  exp?.largest_concentration_pct ?? null,
      hasData:        exp !== null,
    },
    broker,
    alerts: (signalsRes.data ?? []).map((s) => ({
      id: s.id, pair: s.pair, direction: s.direction, at: s.published_at,
    })),
    generatedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

function cap(s: string | null): string {
  if (!s) return 'Broker'
  return s.charAt(0).toUpperCase() + s.slice(1)
}
