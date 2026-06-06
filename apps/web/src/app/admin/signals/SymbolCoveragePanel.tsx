'use client'

/**
 * Symbol Coverage panel (master-prompt layer 6) — surfaces which configured
 * symbols are firing, which are silently filtered/dead, and WHY. Real data
 * from /api/admin/signals/symbol-coverage. Refreshes every 30s.
 */
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CoverageReport, SymbolClass } from '@/lib/intelligence/symbol-coverage'

const CLASS_TONE: Record<SymbolClass, string> = {
  active:   'text-emerald-300',
  dormant:  'text-amber-300',
  filtered: 'text-orange-300',
  inactive: 'text-rose-300',
  degraded: 'text-fuchsia-300',
  never:    'text-rose-400',
}
const ORDER: SymbolClass[] = ['active', 'dormant', 'filtered', 'inactive', 'degraded', 'never']

export default function SymbolCoveragePanel() {
  const [r, setR] = useState<CoverageReport | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/signals/symbol-coverage', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setR(j as CoverageReport)
      setErr(null)
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Symbol coverage</h2>
        {r && <span className="text-[11px] text-muted-foreground">{r.universe_size} symbols · {r.window_days}d window</span>}
      </div>

      {loading && !r ? (
        <p className="text-[12px] text-muted-foreground">Loading coverage…</p>
      ) : err && !r ? (
        <p className="text-[12px] text-rose-400">{err}</p>
      ) : !r ? null : (
        <>
          <div className="flex flex-wrap gap-2">
            {ORDER.map((c) => (
              <span key={c} className={cn('rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[11px] font-semibold', CLASS_TONE[c])}>
                {c} {r.summary[c]}
              </span>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-1.5 pr-2">Symbol</th><th className="py-1.5 px-2">Class</th><th className="py-1.5 px-2 text-right">gen/rej/skip</th><th className="py-1.5 pl-2">Top reason</th></tr>
              </thead>
              <tbody>
                {r.symbols.filter((s) => s.classification !== 'active').slice(0, 20).map((s) => (
                  <tr key={s.symbol} className="border-t border-border/40">
                    <td className="py-1.5 pr-2 font-mono font-semibold">{s.symbol}</td>
                    <td className={cn('py-1.5 px-2 font-medium', CLASS_TONE[s.classification])}>{s.classification}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{s.generated}/{s.rejected}/{s.skipped}</td>
                    <td className="py-1.5 pl-2 font-mono text-[11px] text-muted-foreground">{s.top_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.summary.active === 0 && (
            <p className="mt-2 text-[11px] text-amber-300">
              ⚠ 0 symbols generating signals — see the dominant rejection reason above (e.g. <code>no_ensemble_consensus</code> = ensemble gate too strict).
            </p>
          )}
        </>
      )}
    </div>
  )
}
