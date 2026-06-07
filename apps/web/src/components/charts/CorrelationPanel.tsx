'use client'

/**
 * Cross-asset correlation card for the chart modal.
 *
 * Fetches the existing /api/market/correlations matrix (30d Pearson over
 * the pairs we can source historically — BTC/ETH/SOL/Gold) and highlights
 * any row that touches the current symbol's base. Honest about scope: for
 * instruments outside the computable set we still surface the small matrix
 * as context, labelled accordingly, and link to the full intelligence
 * surface for the rest.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/Skeleton'

interface Row { pair: string; a: string; b: string; correlation: number | null; n: number }
interface Resp { matrix: Row[]; window_days: number; generated_at: string }

function baseOf(symbol: string): string {
  const s = symbol.toUpperCase().replace('/', '')
  if (s.startsWith('XAU')) return 'XAU/USD'
  if (s.endsWith('USDT')) return s.slice(0, -4)
  if (s.endsWith('USDC')) return s.slice(0, -4)
  if (s.endsWith('USD'))  return s.slice(0, -3)
  return s
}

export default function CorrelationPanel({ symbol }: { symbol: string }) {
  const [resp, setResp]       = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch('/api/market/correlations', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<Resp> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { if (!cancelled) { setResp(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'failed'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const base = baseOf(symbol)

  // The /api/market/correlations response is typed as Resp, but the
  // `as Promise<Resp>` cast at fetch time doesn't validate runtime
  // shape. When the engine has no correlation pairs for the current
  // universe yet (a transient state during cold starts and after
  // universe-expansion deploys), the endpoint returns 200 with
  // `matrix` undefined — and `resp.matrix.length` then crashed the
  // ENTIRE /workspace route into the error boundary with the message
  // "Cannot read properties of undefined (reading 'length')".
  // Coerce defensively so a malformed payload degrades to the
  // empty-state UI instead of throwing.
  const matrix = Array.isArray(resp?.matrix) ? resp.matrix : []

  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Correlations (30d)
        </h3>
        <Link href="/intelligence" className="text-[10px] font-semibold text-amber-300/80 hover:text-amber-300">
          Full →
        </Link>
      </div>

      {loading ? (
        <SkeletonText lines={3} />
      ) : error ? (
        <p className="text-xs text-muted-foreground">Correlations unavailable.</p>
      ) : matrix.length === 0 ? (
        <p className="text-xs text-muted-foreground">No correlations on record.</p>
      ) : (
        <ul className="space-y-1">
          {matrix.map((r) => {
            const highlight = r.a === base || r.b === base
            const c = r.correlation
            return (
              <li key={r.pair}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-2 py-1.5',
                    highlight ? 'border-amber-500/40 bg-amber-500/10' : 'border-border/50 bg-background/40',
                  )}>
                <span className="text-xs">{r.pair}</span>
                <span className={cn('text-xs font-semibold tabular-nums', toneFor(c))}>
                  {c == null ? '—' : c.toFixed(2)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function toneFor(c: number | null): string {
  if (c == null) return 'text-muted-foreground'
  if (c >=  0.6) return 'text-emerald-400'
  if (c <= -0.6) return 'text-rose-400'
  if (Math.abs(c) >= 0.3) return 'text-amber-300'
  return 'text-muted-foreground'
}
