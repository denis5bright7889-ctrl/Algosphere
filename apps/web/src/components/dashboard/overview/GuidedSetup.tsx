import { CheckCircle2, PlugZap, ScrollText, Bell, Target, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  brokerConnected: boolean
  hasJournalEntry: boolean
  pushEnabled:     boolean
  hasStrategySub:  boolean
}

interface Step {
  key:   string
  done:  boolean
  icon:  typeof PlugZap
  title: string
  blurb: string
  cta:   { href: string; label: string }
}

/**
 * Guided onboarding. Honest, data-derived signals surfaced as a single
 * prominent next action so a new user always knows the one thing to do
 * next. Self-hides the moment every signal is real-true; never
 * fabricates progress.
 */
export default function GuidedSetup({
  brokerConnected, hasJournalEntry, pushEnabled, hasStrategySub,
}: Props) {
  const steps: Step[] = [
    { key: 'broker',  done: brokerConnected, icon: PlugZap,    title: 'Connect a broker',
      blurb: 'Read-only is fine to start — unlocks live execution and copy routing.',
      cta: { href: '/brokers', label: 'Connect a broker' } },
    { key: 'journal', done: hasJournalEntry, icon: ScrollText, title: 'Log your first trade',
      blurb: 'Unlocks performance analytics, risk telemetry and your verified profile.',
      cta: { href: '/journal', label: 'Open the journal' } },
    { key: 'push',    done: pushEnabled,     icon: Bell,       title: 'Enable alerts',
      blurb: 'Signal, fill and risk alerts — instant, on every device.',
      cta: { href: '/alerts', label: 'Enable alerts' } },
    { key: 'strat',   done: hasStrategySub,  icon: Target,     title: 'Follow a strategy',
      blurb: 'Verified, journal-backed strategies you can follow or copy.',
      cta: { href: '/strategies', label: 'Browse strategies' } },
  ]

  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null

  const total   = steps.length
  const current = steps.find((s) => !s.done)!
  const upcoming = steps.filter((s) => !s.done && s.key !== current.key)
  const CurrentIcon = current.icon
  const stepNo = doneCount + 1
  const pct = Math.round((doneCount / total) * 100)

  return (
    <section className="surface relative overflow-hidden p-5 sm:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" aria-hidden />

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Set up · Step {stepNo} of {total}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">{pct}% ready</span>
      </div>

      {/* Segmented progress — calmer than a single bar */}
      <div className="mb-5 flex gap-1.5">
        {steps.map((s) => (
          <span
            key={s.key}
            className={cn(
              'h-1 flex-1 rounded-full',
              s.done ? 'bg-gradient-primary' : s.key === current.key ? 'bg-amber-400/50' : 'bg-muted/40',
            )}
          />
        ))}
      </div>

      {/* THE next step — single, prominent */}
      <div className="flex flex-col gap-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
          <CurrentIcon className="h-5 w-5 text-amber-300" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold tracking-tight">{current.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{current.blurb}</p>
        </div>
        <a
          href={current.cta.href}
          className="btn-premium shrink-0 !px-5 !py-2.5 !text-sm"
        >
          {current.cta.label}
          <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        </a>
      </div>

      {/* What's next + what's done — quiet, non-competing */}
      {(upcoming.length > 0 || doneCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {doneCount > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-300/80">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {doneCount} done
            </span>
          )}
          {upcoming.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <s.icon className="h-3.5 w-3.5 opacity-60" strokeWidth={1.75} aria-hidden />
              {s.title}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
