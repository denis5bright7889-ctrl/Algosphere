import { createClient } from '@/lib/supabase/server'
import {
  Wallet, Percent, Activity, ScrollText, PlugZap, Radar,
  ShieldAlert, Sparkles, Bell, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import LiveMarketPill from '@/components/ui/LiveMarketPill'
import Panel from '@/components/dashboard/overview/Panel'
import Kpi from '@/components/dashboard/overview/Kpi'

export const metadata = { title: 'Command Center' }

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

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" aria-hidden />
        <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <LiveMarketPill />
            <h1 className="mt-3 truncate text-xl sm:text-3xl font-bold tracking-tight">
              Welcome back<span className="text-gradient">{firstName}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Institutional AI trading command center</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Net P&amp;L</p>
            <p className={
              'text-2xl sm:text-3xl font-bold tabular-nums ' +
              (totalPnl >= 0 ? 'text-emerald-400 glow-text-emerald' : 'text-rose-400 glow-text-rose')
            }>
              <AnimatedNumber value={totalPnl} prefix={totalPnl >= 0 ? '+$' : '-$'} decimals={2} duration={1100} />
            </p>
          </div>
        </div>
      </div>

      {/* KPI telemetry band */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <Kpi label="Net P&L"      value={totalPnl} prefix={totalPnl >= 0 ? '$' : '-$'} decimals={2} icon={Wallet}     tone={totalPnl >= 0 ? 'emerald' : 'rose'} />
        <Kpi label="Win Rate"     value={winRate} suffix="%" icon={Percent}    tone="gold" />
        <Kpi label="Active"       value={active}             icon={Activity}   tone="gold" />
        <Kpi label="Trades"       value={trades}             icon={ScrollText} />
        <Kpi label="Brokers"      text={`${brokerOk}/${brokerCnt}`} icon={PlugZap} tone={brokerCnt && brokerOk === brokerCnt ? 'emerald' : brokerCnt ? 'gold' : 'neutral'} />
        <Kpi label="AI Sentiment" text={senti.label} icon={senti.Icon} tone={senti.tone} />
      </div>

      {/* Main grid: 2/3 content + 1/3 intelligence rail */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Market Regime" icon={Radar} href="/regime">
            {regimes.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {regimes.slice(0, 10).map((r) => (
                  <div key={r.symbol} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
                    <span className="w-16 font-mono text-xs font-semibold">{r.symbol}</span>
                    <RegimeBadge regime={r.regime} compact />
                    <span className="ml-auto">
                      <ConfidencePill score={Math.round(Math.min((r.der_score ?? 0) * 100, 100))} />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Regime engine has not published a scan yet.</p>
            )}
          </Panel>

          <Panel title="Recent Signals" icon={Activity} href="/signals">
            {sigs?.length ? (
              <div className="divide-y divide-border/50">
                {sigs.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={
                        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ' +
                        (s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')
                      }>{s.direction}</span>
                      <span className="font-mono font-semibold">{s.pair ?? '—'}</span>
                    </span>
                    <span className={
                      s.status === 'active' ? 'font-medium text-amber-300'
                      : s.result === 'win'  ? 'font-medium text-emerald-400'
                      : s.result === 'loss' ? 'font-medium text-rose-400'
                      : 'text-muted-foreground'
                    }>
                      {s.status === 'active' ? 'Active' : (s.result ?? s.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No signals published yet.</p>
            )}
          </Panel>

          <Panel title="Recent Trade Log" icon={ScrollText} href="/journal">
            {jrnl?.length ? (
              <div className="divide-y divide-border/50">
                {jrnl.slice(0, 6).map((e, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono font-semibold">{e.pair ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.pips != null ? `${e.pips > 0 ? '+' : ''}${e.pips} pips` : ''}
                    </span>
                    <span className={
                      'tabular-nums font-medium ' +
                      ((e.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')
                    }>
                      {(e.pnl ?? 0) >= 0 ? '+' : ''}${(e.pnl ?? 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No journal entries yet.</p>
            )}
          </Panel>
        </div>

        {/* Intelligence rail */}
        <div className="space-y-5">
          <Panel title="AI Insights" icon={Sparkles}>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {insights.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Risk Warnings" icon={ShieldAlert}>
            {warnings.length ? (
              <ul className="space-y-2 text-sm">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-200">
                    <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                No active risk warnings.
              </p>
            )}
          </Panel>

          <Panel title="Broker Status" icon={PlugZap} href="/brokers" hrefLabel="Manage">
            {brokers?.length ? (
              <div className="space-y-2">
                {brokers.map((b, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <span className="font-semibold capitalize">{b.broker}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{b.is_testnet ? 'testnet' : 'live'}</span>
                      <span className={
                        'rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                        (b.status === 'connected' ? 'bg-emerald-500/15 text-emerald-300'
                          : b.status === 'error'   ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-amber-500/15 text-amber-300')
                      }>{b.status}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No brokers connected. <a href="/brokers" className="text-amber-300 hover:underline">Connect one →</a>
              </p>
            )}
          </Panel>

          <Panel title="Activity" icon={Bell}>
            {(notifs?.length || shadow?.length) ? (
              <ul className="space-y-2 text-sm">
                {notifs?.slice(0, 4).map((n, i) => (
                  <li key={`n${i}`} className="flex gap-2 text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" aria-hidden />
                    <span className="line-clamp-2">{n.message}</span>
                  </li>
                ))}
                {shadow?.slice(0, 3).map((x, i) => (
                  <li key={`s${i}`} className="flex gap-2 text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-400" aria-hidden />
                    <span>{x.symbol} {x.direction} — {x.actual_status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
