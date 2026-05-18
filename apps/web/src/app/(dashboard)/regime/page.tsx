import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Clock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'

export const metadata = { title: 'Market Regime' }
export const dynamic = 'force-dynamic'

/** Three times the claimed 5-min refresh — anything older counts as stale. */
const STALE_MS = 15 * 60_000

function ageMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Date.now() - t : Infinity
}

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown'
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

function derToConfidence(der: number): number {
  // DER 0–1 → 0–100 confidence proxy for display
  return Math.round(Math.min(der * 100, 100))
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
            <RegimeCard key={snap.symbol} snap={snap} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">Regime Legend</h2>
        <div className="flex flex-wrap gap-3">
          {[
            { regime: 'trending',        desc: 'Strong directional momentum. Trend strategies favoured.' },
            { regime: 'mean_reversion',  desc: 'Price reverting to mean. Range/counter-trend setups.' },
            { regime: 'high_volatility', desc: 'ATR elevated. Widen stops. Reduce position size.' },
            { regime: 'exhaustion',      desc: 'No clear structure. Signal engine suppressed.' },
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

function RegimeCard({ snap }: { snap: RegimeSnapshot }) {
  const conf = derToConfidence(snap.der_score)
  const age = ageMs(snap.scanned_at)
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
              title={`Last scan ${fmtAge(age)} — older than the 15-min freshness window`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300"
            >
              <Clock className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden />
              Stale
            </span>
          )}
          <RegimeBadge regime={snap.regime} compact />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <MetricPill label="DER" value={snap.der_score.toFixed(3)} />
        <MetricPill label="Entropy" value={snap.entropy_score.toFixed(3)} />
        <MetricPill label="AutoCorr" value={snap.autocorr_score.toFixed(3)} />
        <MetricPill label="ATR %" value={`${(snap.atr_pct * 100).toFixed(2)}%`} />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground capitalize">
          {snap.session ? snap.session.replace('_', ' ') : '—'}
        </span>
        <div className="flex items-center gap-2">
          <ConfidencePill score={conf} />
          <span
            className={cn('text-xs', stale ? 'text-amber-300' : 'text-muted-foreground')}
            title={`Scanned ${fmtAge(age)}`}
          >
            {formatScannedAt(snap.scanned_at)}
          </span>
        </div>
      </div>
    </div>
  )
}
