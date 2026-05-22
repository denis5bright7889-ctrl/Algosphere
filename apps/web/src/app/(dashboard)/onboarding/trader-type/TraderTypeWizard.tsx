'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ARCHETYPES, classify, archetypeOf,
  type TraderType, type ClassificationAnswers,
} from '@/lib/trader-type'

const Q_HOLD = [
  { value: 'seconds', label: 'Seconds — in and out fast' },
  { value: 'minutes', label: 'Minutes — multiple trades per hour' },
  { value: 'hours',   label: 'Hours — closed by end of session' },
  { value: 'days',    label: 'Days — short multi-day moves' },
  { value: 'weeks',   label: 'Weeks — trend rides' },
  { value: 'months',  label: 'Months — long-term conviction' },
] as const

const Q_ACTIVITY = [
  { value: 'very_active', label: 'Very active — at the screen most of the day' },
  { value: 'active',      label: 'Active — checking in often' },
  { value: 'moderate',    label: 'Moderate — a few times a day' },
  { value: 'passive',     label: 'Passive — set and forget' },
] as const

const Q_AUTOMATION = [
  { value: 'manual',     label: 'Manual — I place every trade myself' },
  { value: 'semi_auto',  label: 'Semi-auto — alerts + suggestions, I confirm' },
  { value: 'fully_auto', label: 'Fully auto — bots execute on my behalf' },
] as const

const Q_CAPITAL = [
  { value: 'personal',   label: 'Personal account' },
  { value: 'prop_firm',  label: 'Prop firm challenge / funded account' },
  { value: 'managed',    label: 'Money I manage for someone else' },
  { value: 'experiment', label: 'Paper trading / learning' },
] as const

interface Props {
  initialType:    TraderType | null
  initialAnswers: Record<string, string> | null
}

export default function TraderTypeWizard({ initialType, initialAnswers }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [hold,       setHold]       = useState((initialAnswers?.hold_duration  ?? '') as ClassificationAnswers['hold_duration'] | '')
  const [activity,   setActivity]   = useState((initialAnswers?.activity        ?? '') as ClassificationAnswers['activity'] | '')
  const [automation, setAutomation] = useState((initialAnswers?.automation      ?? '') as ClassificationAnswers['automation'] | '')
  const [capital,    setCapital]    = useState((initialAnswers?.capital_source  ?? '') as ClassificationAnswers['capital_source'] | '')
  // Allow explicit override if user disagrees with the derived suggestion.
  const [override, setOverride] = useState<TraderType | null>(initialType)

  const complete = hold && activity && automation && capital
  const suggested: TraderType | null = useMemo(() => {
    if (!complete) return null
    return classify({
      hold_duration:  hold       as ClassificationAnswers['hold_duration'],
      activity:       activity   as ClassificationAnswers['activity'],
      automation:     automation as ClassificationAnswers['automation'],
      capital_source: capital    as ClassificationAnswers['capital_source'],
    })
  }, [complete, hold, activity, automation, capital])

  const resolved: TraderType | null = override ?? suggested
  const arch = resolved ? archetypeOf(resolved) : null

  function save() {
    if (!complete && !override) {
      setError('Answer all four questions or pick a type directly')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/profile/trader-type', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trader_type: override ?? undefined,
            answers: complete ? {
              hold_duration:  hold,
              activity,
              automation,
              capital_source: capital,
            } : undefined,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? 'Failed')
        }
        router.push('/overview')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="space-y-6">
      <Question
        label="How long do you typically hold a position?"
        options={Q_HOLD}
        value={hold}
        onChange={(v) => { setHold(v as ClassificationAnswers['hold_duration']); setOverride(null) }}
      />
      <Question
        label="How active do you want to be?"
        options={Q_ACTIVITY}
        value={activity}
        onChange={(v) => { setActivity(v as ClassificationAnswers['activity']); setOverride(null) }}
      />
      <Question
        label="Do you want strategies executed automatically?"
        options={Q_AUTOMATION}
        value={automation}
        onChange={(v) => { setAutomation(v as ClassificationAnswers['automation']); setOverride(null) }}
      />
      <Question
        label="Whose capital are you trading?"
        options={Q_CAPITAL}
        value={capital}
        onChange={(v) => { setCapital(v as ClassificationAnswers['capital_source']); setOverride(null) }}
      />

      {arch && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-5">
          <p className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold mb-1">
            Suggested archetype
          </p>
          <h3 className="text-xl font-bold">{arch.label}</h3>
          <p className="text-sm text-muted-foreground mt-1">{arch.blurb}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
            <Stat label="Default SL %"        value={`${(arch.defaultStopLossPct * 100).toFixed(2)}%`} />
            <Stat label="Default risk/trade"  value={`${(arch.defaultRiskPerTrade * 100).toFixed(2)}%`} />
            <Stat label="Default timeframe"   value={arch.defaultTimeframe} />
            <Stat label="Strategy tags"       value={arch.strategyTags.slice(0, 3).join(', ')} />
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Not quite right? Pick a different archetype manually
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {Object.values(ARCHETYPES).map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setOverride(a.key)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    override === a.key
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-border hover:border-amber-500/30',
                  )}
                >
                  <div className="font-semibold">{a.label}</div>
                  <div className="text-muted-foreground mt-0.5 text-[10px]">{a.blurb}</div>
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/overview')}
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || (!complete && !override)}
          className={cn('btn-premium !text-xs !py-2 !px-5', (pending || (!complete && !override)) && 'opacity-50 cursor-not-allowed')}
        >
          {pending ? 'Saving…' : (initialType ? 'Update' : 'Continue')}
        </button>
      </div>
    </div>
  )
}

function Question({
  label, options, value, onChange,
}: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  value:  string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-2">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
              value === opt.value
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-border hover:border-amber-500/30',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="font-mono mt-0.5">{value}</p>
    </div>
  )
}
