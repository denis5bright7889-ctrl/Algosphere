/**
 * /overview — the Command Center, now chart-first (workstation layout).
 *
 * Previously a feed of stacked cards. A trading terminal leads with the
 * chart; the server resolves real KPIs + watchlist + active signals and
 * hands them to <TerminalWorkspace> (the MT5/TV-class client surface).
 *
 * Honesty contract: every number here is computed from real rows or
 * shown as '—'. Demo accounts keep their synthetic fallback (gated by
 * isDemo), nothing fabricated for real users.
 */
import { createClient } from '@/lib/supabase/server'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import type { AssetClass } from '@/lib/market-universe'
import TerminalWorkspace, {
  type WatchItem, type SignalItem, type TerminalKpis,
} from './TerminalWorkspace'

export const metadata = { title: 'Command Center' }
export const dynamic = 'force-dynamic'

type Sb = Awaited<ReturnType<typeof createClient>>

async function latestRegimes(sb: Sb) {
  const { data } = await sb
    .from('regime_snapshots')
    .select('symbol, regime, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(24)
  if (!data) return []
  const seen = new Set<string>()
  return data.filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
}

function sentiment(regimes: { regime: string }[]): TerminalKpis['bias'] {
  let up = 0, down = 0
  for (const r of regimes) {
    const g = (r.regime ?? '').toLowerCase()
    if (g.includes('up') || g.includes('bull')) up++
    else if (g.includes('down') || g.includes('bear')) down++
  }
  if (up === 0 && down === 0) return { label: 'Neutral', tone: 'neutral' }
  if (up > down) return { label: 'Risk-On',  tone: 'emerald' }
  if (down > up) return { label: 'Risk-Off', tone: 'rose' }
  return { label: 'Mixed', tone: 'gold' }
}

// watchlist_items.asset_class can be 'etf' (not a TradingView AssetClass);
// coerce to the closest chartable class so the rail never carries a value
// the chart layer can't map.
function coerceClass(raw: string | null): AssetClass {
  const c = (raw ?? '').toLowerCase()
  if (c === 'etf') return 'stocks'
  const valid: AssetClass[] = ['forex', 'gold', 'indices', 'stocks', 'commodities', 'futures', 'crypto', 'bonds', 'volatility']
  return (valid as string[]).includes(c) ? (c as AssetClass) : 'crypto'
}

// Curated default watchlist for users who haven't pinned their own —
// the liquid majors a desk watches: BTC/ETH, gold, the EUR major, SOL, NAS.
const FALLBACK_SYMBOL: WatchItem = { symbol: 'BTCUSDT', assetClass: 'crypto' }
const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'BTCUSDT', assetClass: 'crypto' },
  { symbol: 'ETHUSDT', assetClass: 'crypto' },
  { symbol: 'SOLUSDT', assetClass: 'crypto' },
  { symbol: 'XAUUSD',  assetClass: 'gold'   },
  { symbol: 'EURUSD',  assetClass: 'forex'  },
  { symbol: 'NAS100',  assetClass: 'indices'},
]

export default async function OverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile }, { data: signals }, { data: journal }, regimes,
    { data: watch },
  ] = await Promise.all([
    supabase.from('profiles').select('account_type').eq('id', user!.id).single(),
    supabase.from('signals')
      .select('id, status, pair, direction, published_at')
      .eq('status', 'active')
      .order('published_at', { ascending: false }).limit(12),
    supabase.from('journal_entries').select('pnl').eq('user_id', user!.id),
    latestRegimes(supabase),
    supabase.from('watchlist_items')
      .select('symbol, asset_class, added_at')
      .eq('user_id', user!.id)
      .order('added_at', { ascending: false }).limit(20),
  ])

  // Demo fallback (synthetic, gated) keeps the surface populated for tours.
  let jrnl = journal as { pnl: number | null }[] | null
  let sigs = (signals ?? []) as { id: string; status: string; pair: string; direction: string }[]
  if (isDemo(profile?.account_type)) {
    if (!jrnl?.length) jrnl = generateDemoJournal(user!.id, 20).map((e) => ({ pnl: e.pnl ?? null }))
    if (!sigs.length) sigs = [
      { id: 'demo-1', status: 'active', pair: 'XAUUSD',  direction: 'buy'  },
      { id: 'demo-2', status: 'active', pair: 'BTCUSDT', direction: 'buy'  },
      { id: 'demo-3', status: 'active', pair: 'EURUSD',  direction: 'sell' },
    ]
  }

  const netPnl  = jrnl?.reduce((s, e) => s + (e.pnl ?? 0), 0) ?? 0
  const trades  = jrnl?.length ?? 0
  const wins    = jrnl?.filter((e) => (e.pnl ?? 0) > 0).length ?? 0
  const winRate = trades ? Math.round((wins / trades) * 100) : 0

  const kpis: TerminalKpis = {
    netPnl, winRate, trades,
    active: sigs.filter((s) => s.status === 'active').length,
    bias: sentiment(regimes),
  }

  const watchlist: WatchItem[] = (watch && watch.length)
    ? watch.map((w) => ({ symbol: w.symbol, assetClass: coerceClass(w.asset_class) }))
    : DEFAULT_WATCHLIST

  const signalItems: SignalItem[] = sigs.map((s) => ({
    id: s.id, pair: s.pair, direction: s.direction, status: s.status,
  }))

  const defaultSymbol = watchlist[0] ?? FALLBACK_SYMBOL

  return (
    <TerminalWorkspace
      kpis={kpis}
      watchlist={watchlist}
      signals={signalItems}
      defaultSymbol={defaultSymbol}
    />
  )
}
