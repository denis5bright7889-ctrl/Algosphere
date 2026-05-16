'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Report {
  discipline_score:  number
  patience_score:    number
  risk_mgmt_score:   number
  consistency_score: number
  overall_score:     number
  primary_strength:  string
  primary_weakness:  string
  top_mistakes:      string[]
  patterns:          string[]
  coaching:          string
  action_plan:       string[]
}

export default function PsychologyClient() {
  const [report, setReport]   = useState<Report | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError]     = useState<string | null>(null)

  function generate() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/psychology')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        setReport(data.report)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (!report && !pending) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <span className="text-4xl">🧠</span>
        <h2 className="text-lg font-bold mt-3">Run Your Weekly Analysis</h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
          Requires at least 5 trades in the last 30 days. Each report uses one
          of your 5 daily AI generations.
        </p>
        <button type="button" onClick={generate} className="btn-premium mt-5 !text-sm">
          Generate Report
        </button>
        {error && <p className="text-xs text-rose-400 mt-3">{error}</p>}
      </div>
    )
  }

  if (pending) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center">
        <div className="inline-block h-8 w-8 rounded-full border-2 border-amber-500/30 border-t-amber-300 animate-spin" />
        <p className="text-sm text-muted-foreground mt-4">
          Analyzing your last 30 days…
        </p>
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Overall Score
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1 text-[11px] hover:border-amber-500/40"
          >
            Re-run
          </button>
        </div>
        <p className="text-5xl font-bold tabular-nums text-amber-300 glow-text-gold mt-1">
          {report.overall_score}
          <span className="text-lg text-muted-foreground font-normal">/100</span>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ScoreBar label="Discipline"  value={report.discipline_score} />
        <ScoreBar label="Patience"    value={report.patience_score} />
        <ScoreBar label="Risk Mgmt"   value={report.risk_mgmt_score} />
        <ScoreBar label="Consistency" value={report.consistency_score} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card title="✨ Primary Strength" body={report.primary_strength} tone="green" />
        <Card title="⚠️ Primary Weakness" body={report.primary_weakness} tone="amber" />
      </div>

      {report.top_mistakes.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Recurring Mistakes
          </p>
          <ul className="space-y-1.5">
            {report.top_mistakes.map((m, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-rose-400">•</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.patterns.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Patterns Detected
          </p>
          <ul className="space-y-1.5">
            {report.patterns.map((p, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-amber-300">→</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
        <p className="text-xs uppercase tracking-widest text-amber-300 font-bold mb-3">
          Coaching
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.coaching}</p>
      </div>

      {report.action_plan.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-emerald-300 font-bold mb-3">
            Action Plan This Week
          </p>
          <ol className="space-y-2">
            {report.action_plan.map((a, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-emerald-300 font-bold">{i + 1}.</span>
                {a}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  const tone = value >= 70 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="font-bold text-foreground tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', tone)}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Card({ title, body, tone }: { title: string; body: string; tone: 'green'|'amber' }) {
  const cls = tone === 'green'
    ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
    : 'border-amber-500/30 bg-amber-500/[0.04]'
  return (
    <div className={cn('rounded-2xl border p-4', cls)}>
      <p className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-80">{title}</p>
      <p className="text-sm">{body}</p>
    </div>
  )
}
