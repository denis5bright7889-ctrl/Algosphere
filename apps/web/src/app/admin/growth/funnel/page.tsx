/**
 * /admin/growth/funnel — 30-day acquisition funnel dashboard.
 *
 * Reads growth_attribution_events + growth_visitors + profiles. Five
 * stages: visitor → signup → broker_connected → trade_synced →
 * premium_upgrade. Each stage shows distinct-user count + conversion
 * rate vs the previous stage. Source-attribution table breaks down
 * traffic by source_kind.
 */
import Link from 'next/link'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { ArrowLeft, ArrowDown, TrendingDown } from 'lucide-react'

export const metadata = { title: 'Funnel — Growth Engine' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface EventRow {
  event:      string
  visitor_id: string | null
  user_id:    string | null
  source_kind: string | null
  occurred_at: string
}

const STAGES: Array<{ event: string; label: string }> = [
  { event: 'pageview',         label: 'Visitors' },
  { event: 'signup',           label: 'Signed up' },
  { event: 'broker_connected', label: 'Broker connected' },
  { event: 'trade_synced',     label: 'First trade' },
  { event: 'premium_upgrade',  label: 'Premium' },
]

export default async function FunnelPage() {
  const sb = db()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const { data: events } = await sb
    .from('growth_attribution_events')
    .select('event, visitor_id, user_id, source_kind, occurred_at')
    .gte('occurred_at', since)
    .limit(50_000)

  const rows = (events ?? []) as EventRow[]

  // Stage counts — distinct visitor for pageview, distinct user for the
  // rest (so a logged-in user clicking around 50 times still = 1 conversion).
  const stageCounts: Record<string, number> = {}
  for (const stage of STAGES) {
    const ids = new Set<string>()
    for (const e of rows) {
      if (e.event !== stage.event) continue
      const id = stage.event === 'pageview' ? e.visitor_id : e.user_id
      if (id) ids.add(id)
    }
    stageCounts[stage.event] = ids.size
  }

  // Source-kind breakdown of pageview traffic.
  const sourceCounts: Record<string, number> = {}
  for (const e of rows) {
    if (e.event !== 'pageview') continue
    const k = e.source_kind ?? 'direct'
    sourceCounts[k] = (sourceCounts[k] ?? 0) + 1
  }
  const sources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Funnel</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          30-day acquisition chain. Each stage is distinct-visitor (for pageviews) or distinct-user (for everything past signup).
        </p>
      </header>

      {/* Funnel stack */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <ol className="space-y-2">
          {STAGES.map((stage, i) => {
            const count = stageCounts[stage.event] ?? 0
            const prev  = i === 0 ? null : stageCounts[STAGES[i - 1]!.event] ?? 0
            const conv  = prev && prev > 0 ? (count / prev) * 100 : null
            return (
              <li key={stage.event}>
                {i > 0 && (
                  <div className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground">
                    <ArrowDown className="h-3 w-3" />
                    {conv != null ? `${conv.toFixed(1)}% conversion` : '—'}
                    {conv != null && conv < 5 && i > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300">
                        <TrendingDown className="h-2.5 w-2.5" /> bottleneck
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 w-32 shrink-0">
                    {stage.label}
                  </span>
                  <span className="text-2xl font-bold tabular-nums">{count.toLocaleString()}</span>
                  <code className="ml-auto font-mono text-[10px] text-muted-foreground">{stage.event}</code>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Source breakdown */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="border-b border-border px-4 py-3 text-sm font-bold">
          Source breakdown (pageviews, 30d)
        </header>
        {sources.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
            No pageview events yet. The /api/track/event pixel is wired to fire on every route change via AttributionTracker (root layout).
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {sources.map(([source, n]) => {
              const pct = sources[0] ? (n / sources[0][1]) * 100 : 0
              return (
                <li key={source} className="px-4 py-2.5 text-[12px]">
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-wider text-amber-300">{source}</span>
                    <span className="font-bold tabular-nums">{n.toLocaleString()}</span>
                    <span className="ml-auto w-12 text-right tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
