import {
  Wallet, Percent, Activity, ScrollText, PlugZap, Radar,
  ShieldAlert, Sparkles, Bell, TrendingUp, Clock, BrainCircuit,
  type LucideIcon,
} from 'lucide-react'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import LiveMarketPill from '@/components/ui/LiveMarketPill'
import SectionHeader from '@/components/ui/SectionHeader'
import Panel from './Panel'
import Kpi from './Kpi'
import SessionIntelligence from './SessionIntelligence'
import MarketMovers from './MarketMovers'

type Tone = 'neutral' | 'emerald' | 'rose' | 'gold'

interface Props {
  firstName: string
  totalPnl:  number
  winRate:   number
  trades:    number
  active:    number
  brokerOk:  number
  brokerCnt: number
  senti:     { label: string; tone: Tone; Icon: LucideIcon }
  regimes:   { symbol: string; regime: string; der_score: number | null }[]
  sigs:      { id: string; status: string; result: string | null; pair: string | null; direction: string }[] | null
  jrnl:      { pnl: number | null; pips: number | null; pair: string | null }[] | null
  shadow:    { symbol: string; direction: string; actual_status: string }[] | null
  notifs:    { message: string }[] | null
  brokers:   { broker: string; status: string; is_testnet: boolean }[] | null
  warnings:  string[]
  insights:  string[]
}

const SENTI_TEXT: Record<Tone, string> = {
  emerald: 'text-emerald-300',
  rose:    'text-rose-300',
  gold:    'text-amber-300',
  neutral: 'text-muted-foreground',
}

/**
 * Intelligence-first command center (beta). Same honest data as the
 * classic view — reordered so narrative + regime + risk lead, and
 * operational telemetry follows. No fabricated metrics anywhere.
 */
export default function IntelligenceOverview(p: Props) {
  const { senti } = p
  const SentiIcon = senti.Icon
  const lead = p.insights[0] ?? 'Connect a broker and follow a strategy to populate live intelligence.'
  const rest = p.insights.slice(1)

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero — calm, narrative-led */}
      <div className="surface relative overflow-hidden p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <LiveMarketPill />
            <h1 className="mt-3 truncate text-xl font-bold tracking-tight sm:text-2xl">
              Good to see you<span className="text-gradient">{p.firstName}</span>
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <SentiIcon className={`h-4 w-4 ${SENTI_TEXT[senti.tone]}`} strokeWidth={2} aria-hidden />
              <span>
                Market bias is{' '}
                <span className={`font-semibold ${SENTI_TEXT[senti.tone]}`}>{senti.label}</span>
                {p.regimes.length ? ` across ${p.regimes.length} instruments.` : '.'}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Net P&amp;L</p>
            <p className={
              'text-2xl font-bold tabular-nums sm:text-3xl ' +
              (p.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')
            }>
              <AnimatedNumber value={p.totalPnl} prefix={p.totalPnl >= 0 ? '+$' : '-$'} decimals={2} duration={900} />
            </p>
          </div>
        </div>
      </div>

      {/* Lead: AI market narrative — the first thing read */}
      <div className="surface p-5">
        <SectionHeader
          icon={BrainCircuit}
          title="AI Market Narrative"
          subtitle="Computed from your real data — factual summary, not a forecast."
          badge={{ label: 'Derived', tone: 'muted' }}
        />
        <p className="text-sm leading-relaxed text-foreground/90">{lead}</p>
        {rest.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border/50 pt-3 text-sm text-muted-foreground">
            {rest.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Risk first — surfaced high, never buried */}
      {p.warnings.length > 0 && (
        <div className="surface p-5">
          <SectionHeader icon={ShieldAlert} title="Risk Warnings" badge={{ label: `${p.warnings.length}`, tone: 'warn' }} />
          <ul className="space-y-2 text-sm">
            {p.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-200">
                <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Regime — full-width scan summary */}
      <Panel
        title="Market Regime"
        icon={Radar}
        href="/regime"
        hint={{
          id: 'overview-regime',
          text: 'A "regime" is the market\'s current behaviour state — trending, ranging, volatile or exhausted — per instrument. Confidence is detector agreement, not a price prediction.',
        }}
      >
        {p.regimes.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.regimes.slice(0, 12).map((r) => (
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

      {/* Two-column: intelligence rail + operational */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Recent Signals" icon={Activity} href="/signals">
            {p.sigs?.length ? (
              <div className="divide-y divide-border/50">
                {p.sigs.map((s) => (
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
            {p.jrnl?.length ? (
              <div className="divide-y divide-border/50">
                {p.jrnl.slice(0, 6).map((e, i) => (
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

          <Panel title="Major Market Movers" icon={TrendingUp} href="/market" hrefLabel="Full tape">
            <MarketMovers />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Session Intelligence" icon={Clock}>
            <SessionIntelligence />
          </Panel>

          <Panel title="AI Insights" icon={Sparkles}>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {p.insights.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Broker Status" icon={PlugZap} href="/brokers" hrefLabel="Manage">
            {p.brokers?.length ? (
              <div className="space-y-2">
                {p.brokers.map((b, i) => (
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
            {(p.notifs?.length || p.shadow?.length) ? (
              <ul className="space-y-2 text-sm">
                {p.notifs?.slice(0, 4).map((n, i) => (
                  <li key={`n${i}`} className="flex gap-2 text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" aria-hidden />
                    <span className="line-clamp-2">{n.message}</span>
                  </li>
                ))}
                {p.shadow?.slice(0, 3).map((x, i) => (
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

      {/* Telemetry — de-emphasised, moved below the narrative */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <Kpi label="Net P&L"      value={p.totalPnl} prefix={p.totalPnl >= 0 ? '$' : '-$'} decimals={2} icon={Wallet}     tone={p.totalPnl >= 0 ? 'emerald' : 'rose'} />
        <Kpi label="Win Rate"     value={p.winRate} suffix="%" icon={Percent}    tone="gold" />
        <Kpi label="Active"       value={p.active}             icon={Activity}   tone="gold" />
        <Kpi label="Trades"       value={p.trades}             icon={ScrollText} />
        <Kpi label="Brokers"      text={`${p.brokerOk}/${p.brokerCnt}`} icon={PlugZap} tone={p.brokerCnt && p.brokerOk === p.brokerCnt ? 'emerald' : p.brokerCnt ? 'gold' : 'neutral'} />
        <Kpi label="AI Sentiment" text={senti.label} icon={SentiIcon} tone={senti.tone} />
      </div>
    </div>
  )
}
