'use client'
/**
 * CorrelationsPanel — V3 Phase 4 (rolling-Pearson strip).
 *
 * Renders /api/market/correlations using the new engine output:
 * Score / Strength / Trend / Direction / Risk Interpretation per pair.
 * UI bar intensity = |r|; tone = sign. Honest fallback: pairs with
 * insufficient history surface as "Recalibrating" with no leaked
 * provider name or HTTP code.
 *
 * Refreshes aligned with the V3 spec correlation cache (60-min TTL).
 */
import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

type Strength =
  | 'Strong Positive' | 'Moderate Positive' | 'Weak'
  | 'Moderate Negative' | 'Strong Negative'
type Trend = 'rising' | 'falling' | 'stable'

interface Row {
  pair:           string
  base:           string
  quote:          string
  score:          number | null
  prior_score:    number | null
  trend:          Trend | null
  strength:       Strength | null
  direction:      '+' | '−' | 'none'
  risk_interpretation: string
  n:              number
}
interface Resp {
  rows:         Row[]
  window_days:  number
  missing:      string[]
  generated_at: string
}


function bar(r: number): { width: number; bg: string } {
  const w = Math.min(100, Math.abs(r) * 100)
  const bg = r > 0 ? 'bg-emerald-500/55' : 'bg-rose-500/55'
  return { width: w, bg }
}

function strengthTone(s: Strength | null): string {
  switch (s) {
    case 'Strong Positive':   return 'text-emerald-300'
    case 'Moderate Positive': return 'text-emerald-300/85'
    case 'Weak':              return 'text-muted-foreground'
    case 'Moderate Negative': return 'text-rose-300/85'
    case 'Strong Negative':   return 'text-rose-300'
    default:                  return 'text-muted-foreground'
  }
}

function TrendBadge({ t }: { t: Trend | null }) {
  if (!t) return <Minus className="h-3 w-3 text-muted-foreground" strokeWidth={2} aria-hidden />
  if (t === 'rising')  return <ArrowUpRight   className="h-3 w-3 text-amber-300" strokeWidth={2} aria-hidden />
  if (t === 'falling') return <ArrowDownRight className="h-3 w-3 text-sky-300" strokeWidth={2} aria-hidden />
  return <Minus className="h-3 w-3 text-muted-foreground" strokeWidth={2} aria-hidden />
}


export default function CorrelationsPanel() {
  const [data, setData] = useState<Resp | null>(null)
  const [err,  setErr]  = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/market/correlations', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(j => { if (alive) setData(j as Resp) })
      .catch(e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [])

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
          Cross-Asset Correlations
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {data ? `${data.window_days}d Pearson · current vs prior window` : err ? 'recalibrating' : 'loading…'}
        </span>
      </div>

      {!data && !err && (
        <p className="text-xs text-muted-foreground py-4 text-center">Computing correlations…</p>
      )}
      {err && !data && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Correlation engine recalibrating — read resumes on the next cycle.
        </p>
      )}

      {data && (
        <div className="space-y-2">
          {data.rows.map(row => (
            <article key={row.pair} className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
              <header className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 font-medium">{row.pair}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-background/60">
                  {row.score !== null && (
                    <div
                      className={`h-full ${bar(row.score).bg}`}
                      style={{ width: `${bar(row.score).width}%` }}
                    />
                  )}
                </div>
                <span className={cn('w-14 text-right tabular-nums font-semibold',
                  row.score === null ? 'text-muted-foreground'
                  : row.score > 0    ? 'text-emerald-300'
                  : row.score < 0    ? 'text-rose-300' : 'text-muted-foreground')}>
                  {row.score === null ? '—' : (row.score > 0 ? '+' : '') + row.score.toFixed(2)}
                </span>
              </header>
              <footer className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span className={cn('flex items-center gap-1 font-semibold uppercase tracking-wider', strengthTone(row.strength))}>
                  {row.strength ?? 'Recalibrating'} <TrendBadge t={row.trend} />
                </span>
                <span className="flex-1 truncate text-right normal-case opacity-80">
                  {row.risk_interpretation}
                </span>
              </footer>
            </article>
          ))}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Rolling 30-day Pearson on daily returns. Strength bands: ±0.70 strong, ±0.40 moderate.
            Trend arrows compare current window to the prior 30-day window.
          </p>
        </div>
      )}
    </section>
  )
}
