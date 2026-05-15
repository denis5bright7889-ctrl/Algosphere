import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import LiveMarketPill from '@/components/ui/LiveMarketPill'

export const metadata = { title: 'Overview' }

async function getLatestRegimes(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('regime_snapshots')
    .select('symbol, regime, der_score, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(20)
  if (!data) return []
  const seen = new Set<string>()
  return data.filter((r) => {
    if (seen.has(r.symbol)) return false
    seen.add(r.symbol)
    return true
  })
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: profile }, { data: signals }, { data: journal }, regimes] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, subscription_tier, subscription_status, created_at, account_type')
      .eq('id', user!.id)
      .single(),
    supabase
      .from('signals')
      .select('id, status, result')
      .order('published_at', { ascending: false })
      .limit(5),
    supabase
      .from('journal_entries')
      .select('pnl, pips')
      .eq('user_id', user!.id),
    getLatestRegimes(supabase),
  ])

  // Demo accounts with empty journal/feed see synthetic numbers so KPIs look alive
  let effectiveJournal = journal as { pnl: number | null; pips: number | null }[] | null
  let effectiveSignals = signals
  if (isDemo(profile?.account_type)) {
    if (!effectiveJournal || effectiveJournal.length === 0) {
      effectiveJournal = generateDemoJournal(user!.id, 20).map((e) => ({
        pnl: e.pnl ?? null, pips: e.pips ?? null,
      }))
    }
    if (!effectiveSignals || effectiveSignals.length === 0) {
      effectiveSignals = [
        { id: 'demo-1', status: 'active',  result: null },
        { id: 'demo-2', status: 'active',  result: null },
        { id: 'demo-3', status: 'closed',  result: 'win' },
        { id: 'demo-4', status: 'closed',  result: 'win' },
        { id: 'demo-5', status: 'closed',  result: 'loss' },
      ]
    }
  }

  const totalPnl = effectiveJournal?.reduce((sum, e) => sum + (e.pnl ?? 0), 0) ?? 0
  const wins = effectiveJournal?.filter((e) => (e.pnl ?? 0) > 0).length ?? 0
  const winRate = effectiveJournal?.length ? Math.round((wins / effectiveJournal.length) * 100) : 0
  const activeSignals = effectiveSignals?.filter((s) => s.status === 'active').length ?? 0

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero header — premium command-center feel */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <LiveMarketPill />
            <h1 className="mt-3 text-xl sm:text-3xl font-bold tracking-tight truncate">
              Welcome back<span className="text-gradient">
                {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your trading command center
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Net P&amp;L
            </p>
            <p className={
              'text-2xl sm:text-3xl font-bold tabular-nums ' +
              (totalPnl >= 0 ? 'text-gradient-emerald glow-text-emerald' : 'text-gradient-rose glow-text-rose')
            }>
              <AnimatedNumber
                value={totalPnl}
                prefix={totalPnl >= 0 ? '+$' : '-$'}
                decimals={2}
                duration={1100}
              />
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active Signals" value={activeSignals} accent="cyan" />
        <StatCard label="Total P&L"     value={totalPnl} prefix="$" decimals={2} highlight={totalPnl >= 0 ? 'green' : 'red'} />
        <StatCard label="Win Rate"      value={winRate} suffix="%" accent="violet" />
        <StatCard label="Total Trades"  value={journal?.length ?? 0} />
      </div>

      {regimes.length > 0 && (
        <div className="card-premium p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold tracking-tight">Market Regime</h2>
            <a href="/regime" className="text-xs text-primary hover:underline">View all →</a>
          </div>
          <div className="flex flex-wrap gap-3">
            {regimes.map((r) => (
              <div key={r.symbol} className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-foreground w-14">{r.symbol}</span>
                <RegimeBadge regime={r.regime} compact />
                <ConfidencePill score={Math.round(Math.min((r.der_score ?? 0) * 100, 100))} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-premium p-5">
        <h2 className="font-semibold tracking-tight mb-3">Recent Signals</h2>
        {effectiveSignals && effectiveSignals.length > 0 ? (
          <ul className="space-y-2">
            {effectiveSignals.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Signal #{s.id.slice(0, 6)}</span>
                <span
                  className={
                    s.status === 'active'
                      ? 'text-blue-600 font-medium'
                      : s.result === 'win'
                      ? 'text-green-600 font-medium'
                      : 'text-red-600 font-medium'
                  }
                >
                  {s.status === 'active' ? 'Active' : s.result ?? s.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No signals yet.</p>
        )}
        <a href="/signals" className="mt-4 block text-xs text-primary hover:underline">
          View all signals →
        </a>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  prefix,
  suffix,
  decimals,
  highlight,
  accent,
}: {
  label:      string
  value:      number
  prefix?:    string
  suffix?:    string
  decimals?:  number
  highlight?: 'green' | 'red'
  accent?:    'cyan' | 'violet'   // legacy names kept for callers — both map to gold tones
}) {
  const valueClass =
    highlight === 'green' ? 'text-emerald-400 glow-text-emerald' :
    highlight === 'red'   ? 'text-rose-400 glow-text-rose' :
    accent === 'cyan'     ? 'text-amber-300 glow-text-gold' :
    accent === 'violet'   ? 'text-yellow-200' :
    ''

  return (
    <div className="card-premium p-3 sm:p-4 relative overflow-hidden">
      {/* Top accent strip */}
      <div className={
        'absolute inset-x-0 top-0 h-px ' +
        (highlight === 'green' ? 'bg-gradient-emerald' :
         highlight === 'red'   ? 'bg-gradient-rose' :
         accent === 'cyan'     ? 'bg-gradient-primary' :
         'bg-gradient-primary opacity-50')
      } aria-hidden />
      <p className="text-[11px] sm:text-xs text-muted-foreground truncate uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-lg sm:text-2xl font-bold tabular-nums truncate ${valueClass}`}>
        <AnimatedNumber
          value={value}
          prefix={prefix}
          suffix={suffix}
          decimals={decimals ?? 0}
          duration={900}
        />
      </p>
    </div>
  )
}
