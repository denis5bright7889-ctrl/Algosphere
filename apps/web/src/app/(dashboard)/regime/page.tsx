import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import RegimeBadge from '@/components/algo/RegimeBadge'
import { ConfidencePill } from '@/components/algo/ConfidenceGauge'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Market Regime</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time regime classification across all monitored pairs. Updated every 5 minutes.
        </p>
      </div>

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
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-bold text-base">{snap.symbol}</span>
          <span className="ml-2 text-xs text-muted-foreground">{snap.timeframe}</span>
        </div>
        <RegimeBadge regime={snap.regime} compact />
      </div>

      <div className="flex flex-wrap gap-2">
        <MetricPill label="DER" value={snap.der_score.toFixed(3)} />
        <MetricPill label="Entropy" value={snap.entropy_score.toFixed(3)} />
        <MetricPill label="AutoCorr" value={snap.autocorr_score.toFixed(3)} />
        <MetricPill label="ATR %" value={`${(snap.atr_pct * 100).toFixed(2)}%`} />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground capitalize">{snap.session?.replace('_', ' ')}</span>
        <div className="flex items-center gap-2">
          <ConfidencePill score={conf} />
          <span className="text-xs text-muted-foreground">{formatScannedAt(snap.scanned_at)}</span>
        </div>
      </div>
    </div>
  )
}
