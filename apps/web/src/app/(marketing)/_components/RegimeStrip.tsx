import { Radar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

/**
 * Marketing-page market regime strip. Pulls the latest distinct
 * snapshot per symbol from regime_snapshots when the public role can
 * read it; otherwise falls back to a neutral "engine standby" tile
 * set so the section still reads as institutional design rather than
 * empty space. No fabricated price moves — regimes are categorical.
 */
const FALLBACK = [
  'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  'NAS100', 'US500', 'US30',
]

function toneFor(regime: string | null): { dot: string; bg: string; label: string } {
  const g = (regime ?? '').toLowerCase()
  if (g.includes('up') || g.includes('bull'))   return { dot: 'bg-emerald-400', bg: 'border-emerald-500/30 bg-emerald-500/5',  label: 'Risk-On' }
  if (g.includes('down') || g.includes('bear')) return { dot: 'bg-rose-400',    bg: 'border-rose-500/30 bg-rose-500/5',         label: 'Risk-Off' }
  if (g.includes('range') || g.includes('mean')) return { dot: 'bg-blue-400',   bg: 'border-blue-500/30 bg-blue-500/5',         label: 'Ranging'  }
  if (g.includes('vol') || g.includes('exhaust')) return { dot: 'bg-amber-400', bg: 'border-amber-500/30 bg-amber-500/5',       label: 'Volatile' }
  return { dot: 'bg-muted-foreground/60', bg: 'border-border bg-muted/10', label: 'Standby' }
}

export default async function RegimeStrip() {
  const supabase = await createClient()

  // Best-effort: anon may not be allowed to read regime_snapshots. We
  // catch and fall back to a neutral 'standby' grid so the section
  // never errors and never invents values.
  type Row = { symbol: string; regime: string | null }
  let rows: Row[] = []
  try {
    const { data } = await supabase
      .from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(40)
    const seen = new Set<string>()
    for (const r of data ?? []) {
      if (!seen.has(r.symbol)) {
        seen.add(r.symbol)
        rows.push({ symbol: r.symbol, regime: r.regime })
        if (rows.length === 10) break
      }
    }
  } catch { /* anon read denied — fall through */ }

  if (rows.length === 0) {
    rows = FALLBACK.map((s) => ({ symbol: s, regime: null }))
  }

  return (
    <section className="border-y border-border/60 bg-muted/20 py-10">
      <div className="mx-auto max-w-6xl px-4">
        <header className="mb-4 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <Radar className="h-3 w-3 text-amber-300" strokeWidth={1.75} />
            Live Market Regime
          </p>
          <p className="text-[10px] text-muted-foreground">
            Updated every 5 min by the AI regime engine
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {rows.map((r) => {
            const t = toneFor(r.regime)
            return (
              <div
                key={r.symbol}
                className={'relative flex flex-col gap-1 rounded-lg border px-2.5 py-2 ' + t.bg}
              >
                <span className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-tight">{r.symbol}</span>
                  <span className={'h-1.5 w-1.5 rounded-full ' + t.dot} aria-hidden />
                </span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  {t.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
