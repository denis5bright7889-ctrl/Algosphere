import { createClient } from '@/lib/supabase/server'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import IntelligenceOverview from '@/components/dashboard/overview/IntelligenceOverview'
import GuidedSetup from '@/components/dashboard/overview/GuidedSetup'

export const metadata = { title: 'Command Center' }
export const dynamic = 'force-dynamic'

type Sb = Awaited<ReturnType<typeof createClient>>

async function latestRegimes(sb: Sb) {
  const { data } = await sb
    .from('regime_snapshots')
    .select('symbol, regime, der_score, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(24)
  if (!data) return []
  const seen = new Set<string>()
  return data.filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
}

function sentiment(regimes: { regime: string }[]) {
  let up = 0, down = 0
  for (const r of regimes) {
    const g = (r.regime ?? '').toLowerCase()
    if (g.includes('up') || g.includes('bull')) up++
    else if (g.includes('down') || g.includes('bear')) down++
  }
  if (up === 0 && down === 0) return { label: 'Neutral', tone: 'neutral' as const, Icon: Minus }
  if (up > down)  return { label: 'Risk-On',  tone: 'emerald' as const, Icon: TrendingUp }
  if (down > up)  return { label: 'Risk-Off', tone: 'rose' as const,    Icon: TrendingDown }
  return { label: 'Mixed', tone: 'gold' as const, Icon: Minus }
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile }, { data: signals }, { data: journal }, regimes,
    { data: brokers }, { data: shadow }, { data: notifs },
    { count: pushCount }, { count: stratSubCount },
  ] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, subscription_tier, account_type')
      .eq('id', user!.id).single(),
    supabase.from('signals')
      .select('id, status, result, pair, direction, published_at')
      .order('published_at', { ascending: false }).limit(6),
    supabase.from('journal_entries')
      .select('pnl, pips, pair, created_at')
      .eq('user_id', user!.id).order('created_at', { ascending: false }),
    latestRegimes(supabase),
    supabase.from('broker_connections')
      .select('broker, status, equity_usd, is_testnet')
      .eq('user_id', user!.id),
    supabase.from('shadow_executions')
      .select('symbol, direction, actual_status, slippage_pct, created_at')
      .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(6),
    supabase.from('social_notifications')
      .select('notif_type, message, created_at')
      .eq('recipient_id', user!.id).order('created_at', { ascending: false }).limit(6),
    // Onboarding signals — only counts, no rows. Cheap.
    supabase.from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user!.id),
    supabase.from('strategy_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('subscriber_id', user!.id),
  ])

  // Demo accounts keep their established synthetic fallback (gated by isDemo).
  let jrnl = journal as { pnl: number | null; pips: number | null; pair: string | null; created_at: string }[] | null
  let sigs = signals
  if (isDemo(profile?.account_type)) {
    if (!jrnl?.length) jrnl = generateDemoJournal(user!.id, 20).map((e) => ({
      pnl: e.pnl ?? null, pips: e.pips ?? null, pair: e.pair ?? null, created_at: new Date().toISOString(),
    }))
    if (!sigs?.length) sigs = [
      { id: 'demo-1', status: 'active', result: null, pair: 'XAUUSD', direction: 'buy',  published_at: new Date().toISOString() },
      { id: 'demo-2', status: 'closed', result: 'win',  pair: 'EURUSD', direction: 'sell', published_at: new Date().toISOString() },
      { id: 'demo-3', status: 'closed', result: 'loss', pair: 'BTCUSDT', direction: 'buy', published_at: new Date().toISOString() },
    ]
  }

  const totalPnl  = jrnl?.reduce((s, e) => s + (e.pnl ?? 0), 0) ?? 0
  const trades    = jrnl?.length ?? 0
  const wins      = jrnl?.filter((e) => (e.pnl ?? 0) > 0).length ?? 0
  const winRate   = trades ? Math.round((wins / trades) * 100) : 0
  const active    = sigs?.filter((s) => s.status === 'active').length ?? 0
  const brokerOk  = brokers?.filter((b) => b.status === 'connected').length ?? 0
  const brokerCnt = brokers?.length ?? 0
  const senti     = sentiment(regimes)

  // Derived risk warnings — honest rules over real data, never invented.
  const warnings: string[] = []
  if (brokers?.some((b) => b.status === 'error'))
    warnings.push('A broker connection is in an error state — check Broker Connections.')
  if (trades >= 5 && totalPnl < 0)
    warnings.push(`Net P&L is negative ($${totalPnl.toFixed(2)}) across ${trades} trades.`)
  if (trades >= 10 && winRate < 40)
    warnings.push(`Win rate ${winRate}% is below the 40% caution threshold.`)
  if (brokerCnt > 0 && brokers?.every((b) => b.is_testnet))
    warnings.push('All broker connections are testnet — no live execution yet.')

  // Derived insights — computed, not fabricated.
  const insights: string[] = []
  if (regimes.length)
    insights.push(`${senti.label} bias across ${regimes.length} instruments in the latest regime pass.`)
  if (active > 0) insights.push(`${active} active signal${active > 1 ? 's' : ''} currently open.`)
  if (shadow?.length) {
    const avgSlip = shadow.reduce((s, x) => s + Math.abs(x.slippage_pct ?? 0), 0) / shadow.length
    insights.push(`Recent shadow fills average ${(avgSlip * 100).toFixed(3)}% slippage.`)
  }
  if (!insights.length) insights.push('Connect a broker and follow a strategy to populate live intelligence.')

  const firstName = profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''

  // Onboarding signals — derived from real fetches above. GuidedSetup
  // self-hides the moment every box is genuinely true. Uses the *raw*
  // journal data, not the demo-gated `jrnl` override — a demo user
  // shouldn't tick "Log your first trade" from synthetic data.
  const brokerConnected = brokers?.some((b) => b.status === 'connected') ?? false
  const hasJournalEntry = (journal?.length ?? 0) > 0
  const pushEnabled     = (pushCount ?? 0) > 0
  const hasStrategySub  = (stratSubCount ?? 0) > 0

  return (
    <div className="space-y-5">
      <GuidedSetup
        brokerConnected={brokerConnected}
        hasJournalEntry={hasJournalEntry}
        pushEnabled={pushEnabled}
        hasStrategySub={hasStrategySub}
      />
      <IntelligenceOverview
        firstName={firstName}
        totalPnl={totalPnl}
        winRate={winRate}
        trades={trades}
        active={active}
        brokerOk={brokerOk}
        brokerCnt={brokerCnt}
        senti={senti}
        regimes={regimes}
        sigs={sigs}
        jrnl={jrnl}
        shadow={shadow}
        notifs={notifs}
        brokers={brokers}
        warnings={warnings}
        insights={insights}
      />
    </div>
  )
}
