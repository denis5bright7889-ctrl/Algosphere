'use client'
/**
 * CorrelationsPanel — cross-asset Pearson correlation strip.
 *
 * Renders /api/market/correlations. Correlations live in the [-1, 1] range;
 * UI shows a coloured bar (red for negative, green for positive, intensity
 * = |r|). Honest gaps: a pair with `correlation: null` (one side's data
 * was missing — e.g. Twelve Data key not configured) renders as "—" with
 * an explanatory note. Refreshes every 6h aligned with the cache TTL.
 */
import { useEffect, useState } from 'react'

interface Row { pair: string; a: string; b: string; correlation: number | null; n: number }
interface Resp { matrix: Row[]; window_days: number; generated_at: string }

function bandLabel(r: number): string {
  const a = Math.abs(r)
  if (a >= 0.7) return r > 0 ? 'Strong +' : 'Strong −'
  if (a >= 0.4) return r > 0 ? 'Moderate +' : 'Moderate −'
  if (a >= 0.15) return r > 0 ? 'Weak +' : 'Weak −'
  return 'Neutral'
}

function bar(r: number): { width: number; bg: string } {
  const w = Math.min(100, Math.abs(r) * 100)
  const bg = r > 0 ? 'bg-emerald-500/55' : 'bg-rose-500/55'
  return { width: w, bg }
}

export default function CorrelationsPanel() {
  const [data, setData] = useState<Resp | null>(null)
  const [err,  setErr]  = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/market/correlations', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`correlations ${r.status}`); return r.json() })
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
          {data ? `${data.window_days}d daily returns` : err ? 'unavailable' : 'loading…'}
        </span>
      </div>

      {!data && !err && (
        <p className="text-xs text-muted-foreground py-4 text-center">Computing correlations…</p>
      )}
      {err && !data && (
        <p className="text-xs text-muted-foreground py-4 text-center">Correlation feed unavailable.</p>
      )}

      {data && (
        <div className="space-y-1.5">
          {data.matrix.map(row => (
            <div key={row.pair} className="grid grid-cols-[140px_1fr_70px_60px] items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
              <span className="font-medium">{row.pair}</span>
              <div className="h-1.5 w-full overflow-hidden rounded bg-background/60">
                {row.correlation !== null && (
                  <div
                    className={`h-full ${bar(row.correlation).bg}`}
                    // eslint-disable-next-line react/forbid-dom-props
                    style={{ width: `${bar(row.correlation).width}%` }}
                  />
                )}
              </div>
              <span className={`tabular-nums text-right font-semibold ${
                row.correlation === null ? 'text-muted-foreground'
                : row.correlation > 0    ? 'text-emerald-400'
                : row.correlation < 0    ? 'text-rose-400' : ''}`}>
                {row.correlation === null ? '—' : (row.correlation > 0 ? '+' : '') + row.correlation.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground text-right">
                {row.correlation === null ? 'no data' : bandLabel(row.correlation)}
              </span>
            </div>
          ))}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Pearson correlation of daily returns over the last {data.window_days} trading days.
            &quot;—&quot; = one side&apos;s price history isn&apos;t available (provider not keyed).
          </p>
        </div>
      )}
    </section>
  )
}
