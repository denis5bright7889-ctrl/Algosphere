'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle } from 'lucide-react'

/**
 * The shape mirrors FIRM_PRESETS in /api/prop/route.ts — single source
 * of truth lives server-side; this is the UI mirror used to pre-fill
 * the form. profit/daily/total are %; minDays/maxDays are days.
 */
const PRESETS: Record<string, { profit: number; daily: number; total: number; minDays: number; maxDays: number }> = {
  FTMO:            { profit: 10, daily: 5, total: 10, minDays: 4, maxDays: 30 },
  TheFundedTrader: { profit: 8,  daily: 5, total: 12, minDays: 0, maxDays: 30 },
  MyForexFunds:    { profit: 8,  daily: 5, total: 12, minDays: 0, maxDays: 30 },
  Apex:            { profit: 6,  daily: 3, total: 6,  minDays: 0, maxDays: 30 },
  'The5ers':       { profit: 6,  daily: 4, total: 5,  minDays: 0, maxDays: 0  },
  Other:           { profit: 10, daily: 5, total: 10, minDays: 4, maxDays: 30 },
}

const SIZES = [10_000, 25_000, 50_000, 100_000, 200_000]
const PHASES = ['challenge', 'verification', 'funded'] as const

export default function NewChallengeForm() {
  const router = useRouter()
  const [firm, setFirm] = useState<keyof typeof PRESETS>('FTMO')
  const [size, setSize] = useState(50_000)
  const [phase, setPhase] = useState<typeof PHASES[number]>('challenge')
  const [mt5, setMt5] = useState('')

  // Advanced overrides — empty string keeps the preset.
  const [profitTarget, setProfitTarget] = useState('')
  const [dailyLoss, setDailyLoss] = useState('')
  const [totalLoss, setTotalLoss] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = PRESETS[firm]!

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        firm_name:        firm,
        account_size_usd: size,
        phase,
      }
      if (mt5.trim())         body.mt5_account_id    = mt5.trim()
      if (profitTarget)       body.profit_target_pct  = Number(profitTarget)
      if (dailyLoss)          body.max_daily_loss_pct = Number(dailyLoss)
      if (totalLoss)          body.max_total_loss_pct = Number(totalLoss)

      const res  = await fetch('/api/prop', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`)
      router.push('/prop')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create challenge.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Field label="Firm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.keys(PRESETS).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFirm(k as keyof typeof PRESETS)}
              className={`min-h-[40px] rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                firm === k
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                  : 'border-border bg-card text-muted-foreground hover:border-amber-500/30 hover:text-foreground'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Account size (USD)">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`min-h-[40px] rounded-md border px-2 py-2 text-sm font-semibold tabular-nums transition-colors ${
                size === s
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                  : 'border-border bg-card text-muted-foreground hover:border-amber-500/30 hover:text-foreground'
              }`}
            >
              ${(s / 1000).toLocaleString('en-US')}K
            </button>
          ))}
        </div>
      </Field>

      <Field label="Phase">
        <div className="grid grid-cols-3 gap-2">
          {PHASES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPhase(p)}
              className={`min-h-[40px] rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                phase === p
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                  : 'border-border bg-card text-muted-foreground hover:border-amber-500/30 hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>

      <Field label="MT5 account ID (optional)">
        <input
          type="text"
          value={mt5}
          onChange={(e) => setMt5(e.target.value)}
          placeholder="e.g. 12345678"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          maxLength={40}
        />
      </Field>

      <details className="rounded-lg border border-border/70 bg-card/50 px-4 py-3 group open:pb-4">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Advanced — override rules
          <span className="ml-2 text-[10px] font-normal normal-case text-muted-foreground/70 group-open:hidden">
            (preset: {preset.profit}% target · {preset.daily}% daily · {preset.total}% total)
          </span>
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <OverrideInput label={`Profit target % (preset ${preset.profit})`}    value={profitTarget} onChange={setProfitTarget} />
          <OverrideInput label={`Max daily loss % (preset ${preset.daily})`}    value={dailyLoss}    onChange={setDailyLoss} />
          <OverrideInput label={`Max total loss % (preset ${preset.total})`}    value={totalLoss}    onChange={setTotalLoss} />
        </div>
      </details>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push('/prop')}
          className="btn-glass !text-sm"
          disabled={submitting}
        >
          Cancel
        </button>
        <button type="submit" className="btn-premium !text-sm" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
              Creating…
            </>
          ) : (
            'Create challenge'
          )}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function OverrideInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm tabular-nums focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
      />
    </label>
  )
}
