import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Clock, AlertTriangle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'
import {
  marketState, trendStrength, confidencePct, volatilityLevel,
  momentumConsistency, marketStructure, sessionLabel, stateTone,
} from '@/lib/market-language'
import { composeRegimeTransition, type RegimeTransitionView } from '@/lib/regime-transition'

export const metadata = { title: 'Market Regime' }
export const dynamic = 'force-dynamic'

/** Three times the claimed 5-min refresh — anything older counts as stale. */
const STALE_MS = 15 * 60_000

function ageMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Date.now() - t : Infinity
}

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'a while ago'
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h ago`
}

interface RegimeSnapshot {
  id: string
  symbol: string
  timeframe: string
  regime: string
  der_score: number
  entropy_score: number
  autocorr_score: number
  atr_pct: number
  session: string
  scanned_at: string
}

async function getLatestRegimes(): Promise<RegimeSnapshot[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('regime_snapshots')
    .select('*')
    .order('scanned_at', { ascending: false })
    .limit(40)

  if (!data) return []

  // Keep only the most recent snapshot per symbol
  const seen = new Set<string>()
  return data.filter((row) => {
    if (seen.has(row.symbol)) return false
    seen.add(row.symbol)
    return true
  })
}

function formatScannedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function MetricPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded bg-muted/30 px-2 py-1">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export default async function RegimePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const snapshots = await getLatestRegimes()
  // Compose the transition view per symbol in parallel — answers
  // "what the market IS BECOMING" in addition to what it currently is.
  const transitions = new Map<string, RegimeTransitionView>()
  if (snapshots.length > 0) {
    const views = await Promise.all(snapshots.map((s) => composeRegimeTransition(s.symbol)))
    for (const v of views) transitions.set(v.symbol, v)
  }
  const newestAgeMs = snapshots.length
    ? Math.min(...snapshots.map((s) => ageMs(s.scanned_at)))
    : Infinity
  // 'Engine idle' = we have snapshots but they're ALL stale. The
  // refresh promise in the subtitle must reflect reality, not just
  // restate the spec.
  const engineIdle = snapshots.length > 0 && newestAgeMs > STALE_MS

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Market Regime</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Regime classification across monitored pairs. Engine scans every 5 minutes
          when active.
        </p>
      </div>

      {engineIdle && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            <span className="font-semibold">Signal engine appears idle.</span>{' '}
            Most recent scan was {fmtAge(newestAgeMs)} — the cards below show the last
            classification on record, not current state. New scans will refresh this
            page automatically when the engine resumes.
          </span>
        </div>
      )}

      {snapshots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">
            No regime data yet. The signal engine will populate this once it starts scanning.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((snap) => (
            <RegimeCard key={snap.symbol} snap={snap} trans={transitions.get(snap.symbol)} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">Market State Legend</h2>
        <div className="flex flex-wrap gap-3">
          {[
            { regime: 'trending',        desc: 'Strong directional momentum — trend setups favoured.' },
            { regime: 'mean_reversion',  desc: 'Price holding a range — counter-trend / range setups.' },
            { regime: 'high_volatility', desc: 'Volatility elevated — wider stops, smaller size.' },
            { regime: 'expansion',       desc: 'Vol building, breakout setup forming — energy growing.' },
            { regime: 'transitional',    desc: 'Regime shift in progress — low conviction window.' },
            { regime: 'exhaustion',      desc: 'Structure unclear — low conviction, awaiting confirmation.' },
          ].map(({ regime, desc }) => (
            <div key={regime} className="flex items-start gap-2">
              <RegimeBadge regime={regime} compact />
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function stabilityTone(s: RegimeTransitionView['stability']): string {
  switch (s) {
    case 'Stable':   return 'text-emerald-400'
    case 'Drifting': return 'text-amber-400'
    case 'Unstable': return 'text-rose-400'
    default:         return 'text-muted-foreground'
  }
}
function transitionTone(t: RegimeTransitionView['transition']): string {
  switch (t) {
    case 'Likely':   return 'text-rose-400'
    case 'Possible': return 'text-amber-400'
    case 'Unlikely': return 'text-emerald-400/70'
    default:         return 'text-muted-foreground'
  }
}

function IntelRow({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-semibold', tone)}>{value}</span>
    </div>
  )
}

function RegimeCard({ snap, trans }: { snap: RegimeSnapshot; trans?: RegimeTransitionView }) {
  // Readable intelligence — engines run unchanged, this only translates output.
  const state   = marketState(snap.regime)
  const conf    = confidencePct(snap.der_score)
  const strength = trendStrength(snap.der_score)
  const vol     = volatilityLevel(snap.atr_pct)
  const mom     = momentumConsistency(snap.autocorr_score)
  const struct  = marketStructure(snap.regime)
  const age   = ageMs(snap.scanned_at)
  const stale = age > STALE_MS

  return (
    <div className={cn(
      'space-y-3 rounded-lg border bg-card p-4',
      stale ? 'border-amber-500/30' : 'border-border',
    )}>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-bold text-base">{snap.symbol}</span>
          <span className="ml-2 text-xs text-muted-foreground">{snap.timeframe}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {stale && (
            <span
              title={`Last update ${fmtAge(age)}`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300"
            >
              <Clock className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden />
              Delayed
            </span>
          )}
          <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold', stateTone(state))}>
            {state}
          </span>
        </div>
      </div>

      {/* Transition strip — what the market IS BECOMING. Renders only when
          the trajectory layer derived a meaningful read; quietly hidden
          when stability='N/A' so the card doesn't show empty rows. */}
      {trans && trans.stability !== 'N/A' && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/10 px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Stability</span>
            <span className={cn('text-xs font-semibold', stabilityTone(trans.stability))}>{trans.stability}</span>
          </div>
          <div className="flex items-center gap-2">
            {trans.transitioning_to ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
                <span className={cn('font-semibold', stateTone(trans.transitioning_to).split(' ')[0])}>{trans.transitioning_to}</span>
              </span>
            ) : (
              <span className={cn('text-[11px] font-semibold', transitionTone(trans.transition))}>
                {trans.transition === 'N/A' ? '' : `${trans.transition} transition`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Readable market intelligence (default view) */}
      <div className="space-y-1.5">
        <IntelRow label="Trend Strength" value={strength} />
        <IntelRow label="Volatility"     value={vol}
                  tone={vol === 'High' ? 'text-amber-400' : vol === 'Elevated' ? 'text-amber-300/80' : ''} />
        <IntelRow label="Momentum"       value={mom} />
        <IntelRow label="Structure"      value={struct}
                  tone={struct === 'Choppy' ? 'text-amber-300/80' : ''} />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground">{sessionLabel(snap.session)}</span>
        <div className="flex items-center gap-2">
          <ConfidencePill score={conf} />
          <span
            className={cn('text-xs', stale ? 'text-amber-300' : 'text-muted-foreground')}
            title={`Updated ${fmtAge(age)}`}
          >
            {formatScannedAt(snap.scanned_at)}
          </span>
        </div>
      </div>

      {/* Raw quant internals — opt-in, collapsed by default */}
      <details className="group rounded-md border border-border/60 bg-muted/10">
        <summary className="cursor-pointer list-none px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground">
          Advanced Quant Metrics
        </summary>
        <div className="flex flex-wrap gap-2 px-3 pb-3 pt-1">
          <MetricPill label="DER"      value={snap.der_score.toFixed(3)} />
          <MetricPill label="Entropy"  value={snap.entropy_score.toFixed(3)} />
          <MetricPill label="AutoCorr" value={snap.autocorr_score.toFixed(3)} />
          <MetricPill label="ATR %"    value={`${(snap.atr_pct * 100).toFixed(2)}%`} />
          <MetricPill label="Regime"   value={snap.regime || 'n/a'} />
        </div>
      </details>
    </div>
  )
}
