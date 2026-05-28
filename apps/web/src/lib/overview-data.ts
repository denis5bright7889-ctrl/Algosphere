/**
 * Shared server helper that builds the props for <TerminalWorkspace>.
 *
 * Used by /overview (the Command Center) AND by /workspace (mobile
 * cockpit fallback — phones get the cockpit instead of the desktop
 * multi-chart). Keeping the computation in one place stops the two
 * pages drifting.
 *
 * Honesty contract preserved: every number is computed from real rows
 * or rendered as '—'. Demo accounts keep their gated synthetic fallback.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import type { AssetClass } from '@/lib/market-universe'
import type {
  WatchItem, SignalItem, TerminalKpis,
} from '@/app/(dashboard)/overview/TerminalWorkspace'

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

function coerceClass(raw: string | null): AssetClass {
  const c = (raw ?? '').toLowerCase()
  if (c === 'etf') return 'stocks'
  const valid: AssetClass[] = ['forex', 'gold', 'indices', 'stocks', 'commodities', 'futures', 'crypto', 'bonds', 'volatility']
  return (valid as string[]).includes(c) ? (c as AssetClass) : 'crypto'
}

export const FALLBACK_SYMBOL: WatchItem = { symbol: 'BTCUSDT', assetClass: 'crypto' }
export const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'BTCUSDT', assetClass: 'crypto' },
  { symbol: 'ETHUSDT', assetClass: 'crypto' },
  { symbol: 'SOLUSDT', assetClass: 'crypto' },
  { symbol: 'XAUUSD',  assetClass: 'gold'   },
  { symbol: 'EURUSD',  assetClass: 'forex'  },
  { symbol: 'NAS100',  assetClass: 'indices'},
]

export interface OverviewData {
  kpis:          TerminalKpis
  watchlist:     WatchItem[]
  signals:       SignalItem[]
  defaultSymbol: WatchItem
}

export async function getOverviewData(): Promise<OverviewData> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Caller is auth-gated; this is a defensive fallback.
    return { kpis: { netPnl: 0, winRate: 0, trades: 0, active: 0, bias: { label: 'Neutral', tone: 'neutral' } },
             watchlist: DEFAULT_WATCHLIST, signals: [], defaultSymbol: FALLBACK_SYMBOL }
  }

  const [
    { data: profile }, { data: signals }, { data: journal }, regimes, { data: watch },
  ] = await Promise.all([
    supabase.from('profiles').select('account_type').eq('id', user.id).single(),
    supabase.from('signals')
      .select('id, status, pair, direction, published_at')
      .eq('status', 'active')
      .order('published_at', { ascending: false }).limit(12),
    supabase.from('journal_entries').select('pnl').eq('user_id', user.id),
    latestRegimes(supabase),
    supabase.from('watchlist_items')
      .select('symbol, asset_class, added_at')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false }).limit(20),
  ])

  let jrnl = journal as { pnl: number | null }[] | null
  let sigs = (signals ?? []) as { id: string; status: string; pair: string; direction: string }[]
  if (isDemo(profile?.account_type)) {
    if (!jrnl?.length) jrnl = generateDemoJournal(user.id, 20).map((e) => ({ pnl: e.pnl ?? null }))
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

  return { kpis, watchlist, signals: signalItems, defaultSymbol: watchlist[0] ?? FALLBACK_SYMBOL }
}
