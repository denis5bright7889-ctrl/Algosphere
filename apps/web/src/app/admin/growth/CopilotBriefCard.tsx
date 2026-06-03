'use client'

/**
 * CopilotBriefCard — top-of-overview panel showing the latest AI
 * Growth Copilot brief. Reads on mount; "Regenerate now" calls
 * POST /api/admin/growth/copilot.
 *
 * Pure render. Lives client-side so the regenerate button works
 * without a full reload.
 */
import { useEffect, useState, useTransition } from 'react'
import { Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowUpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Action {
  title:  string
  why:    string
  impact: 'high' | 'medium' | 'low'
}

interface Signals {
  window_start: string
  window_end:   string
  funnel: {
    visitors:         number
    signups:          number
    broker_connected: number
    trade_synced:     number
    premium_upgrade:  number
    conv: {
      visitor_to_signup:  number | null
      signup_to_broker:   number | null
      broker_to_trade:    number | null
      trade_to_premium:   number | null
    }
  }
}

interface Brief {
  id?:           string
  window_start:  string
  window_end:    string
  signals:       Signals
  summary_md:    string
  actions:       Action[]
  model:         string | null
  generated_at?: string
}

const IMPACT_CLS: Record<Action['impact'], string> = {
  high:   'border-rose-500/50    bg-rose-500/[0.08]    text-rose-200',
  medium: 'border-amber-500/50   bg-amber-500/[0.08]   text-amber-200',
  low:    'border-sky-500/40     bg-sky-500/[0.06]     text-sky-200',
}

export default function CopilotBriefCard() {
  const [brief, setBrief]   = useState<Brief | null>(null)
  const [loading, setL]     = useState(true)
  const [pending, start]    = useTransition()
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/growth/copilot', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setBrief(j.brief))
      .catch(() => {})
      .finally(() => setL(false))
  }, [])

  function regen() {
    setError(null)
    start(async () => {
      const r = await fetch('/api/admin/growth/copilot', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Generation failed'); return }
      setBrief(j.brief)
    })
  }

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.05] to-amber-500/[0.01] p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          <h2 className="text-sm font-bold">Growth Copilot</h2>
          {brief?.generated_at && (
            <span className="text-[10px] text-muted-foreground">
              · brief {new Date(brief.generated_at).toLocaleString()}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={regen}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate now
        </button>
      </header>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">Loading latest brief…</p>
      ) : !brief ? (
        <p className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-center text-[12px] text-muted-foreground">
          No brief yet. Click <span className="font-semibold text-amber-300">Regenerate now</span> to produce one — runs the deterministic aggregator + Gemini synth and persists the row.
        </p>
      ) : (
        <>
          {/* Funnel mini-strip */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Visitors"  value={brief.signals.funnel.visitors} />
            <Stat label="Signups"   value={brief.signals.funnel.signups}   conv={brief.signals.funnel.conv.visitor_to_signup} />
            <Stat label="Brokers"   value={brief.signals.funnel.broker_connected} conv={brief.signals.funnel.conv.signup_to_broker} />
            <Stat label="Trades"    value={brief.signals.funnel.trade_synced}     conv={brief.signals.funnel.conv.broker_to_trade} />
            <Stat label="Premium"   value={brief.signals.funnel.premium_upgrade}  conv={brief.signals.funnel.conv.trade_to_premium} />
          </div>

          {/* Summary markdown — rendered as plain whitespace-preserved
              text for now. A future slice can plug in a real md renderer. */}
          <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-[13px] text-foreground/85 mb-4">
            {brief.summary_md}
          </div>

          {/* Ranked actions */}
          {brief.actions.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
                Ranked actions
              </p>
              <ul className="space-y-2">
                {brief.actions.map((a, i) => (
                  <li key={i} className={cn('rounded-lg border p-3 text-[12px]', IMPACT_CLS[a.impact])}>
                    <div className="flex items-start gap-2">
                      <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-snug">{a.title}</p>
                        <p className="mt-1 opacity-90 leading-relaxed">{a.why}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                        {a.impact}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.model && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              Synth: {brief.model} · window {brief.window_start.slice(0,10)} → {brief.window_end.slice(0,10)}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value, conv }: { label: string; value: number; conv?: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
      {conv != null && (
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {(conv * 100).toFixed(1)}%
        </p>
      )}
    </div>
  )
}
