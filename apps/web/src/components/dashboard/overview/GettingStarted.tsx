import { CheckCircle2, Circle, PlugZap, ScrollText, Bell, Target, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChecklistItem {
  key:   string
  done:  boolean
  /** lucide icon to render in front of the title */
  icon:  typeof PlugZap
  title: string
  blurb: string
  cta:   { href: string; label: string }
}

interface Props {
  brokerConnected:   boolean
  hasJournalEntry:   boolean
  pushEnabled:       boolean
  hasStrategySub:    boolean
}

/**
 * First-time-user nudge panel for /overview.
 *
 * Renders only when at least one onboarding box is unchecked — and
 * disappears entirely once the user has crossed the setup threshold.
 * No dismiss button is needed because the state is derived from real
 * data (you connected a broker → the box ticks itself), so the panel
 * never lies about progress and never lingers after it's irrelevant.
 *
 * Every "done" check is a real signal:
 *   - brokerConnected: any broker_connections row in 'connected' state
 *   - hasJournalEntry: at least one journal_entries row exists
 *   - pushEnabled:     at least one push_subscriptions row exists
 *   - hasStrategySub:  any strategy_subscriptions row (active or
 *                      historical) — engagement signal, not just live
 */
export default function GettingStarted({
  brokerConnected, hasJournalEntry, pushEnabled, hasStrategySub,
}: Props) {
  const items: ChecklistItem[] = [
    {
      key: 'broker',
      done: brokerConnected,
      icon: PlugZap,
      title: 'Connect a broker',
      blurb: 'Required for live execution and copy-trade routing.',
      cta: { href: '/brokers', label: 'Connect →' },
    },
    {
      key: 'journal',
      done: hasJournalEntry,
      icon: ScrollText,
      title: 'Log your first trade',
      blurb: 'Unlocks performance analytics, risk telemetry and your verified profile.',
      cta: { href: '/journal', label: 'Open journal →' },
    },
    {
      key: 'push',
      done: pushEnabled,
      icon: Bell,
      title: 'Enable push notifications',
      blurb: 'Signal alerts, copy-trade fills and risk warnings — instant, on every device.',
      cta: { href: '/alerts', label: 'Enable →' },
    },
    {
      key: 'strategies',
      done: hasStrategySub,
      icon: Target,
      title: 'Browse the strategy marketplace',
      blurb: 'Verified, journal-backed strategies you can follow or copy.',
      cta: { href: '/strategies', label: 'Browse →' },
    },
  ]

  const completed = items.filter((i) => i.done).length
  if (completed === items.length) return null
  const pct = Math.round((completed / items.length) * 100)

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-500/30 glass p-4 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" aria-hidden />

      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          Get set up
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {completed} of {items.length} · {pct}%
        </span>
      </header>

      {/* Progress strip */}
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-muted/40">
        <div
          className="h-full rounded-full bg-gradient-primary transition-[width] duration-500"
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2">
        {items.map((it) => {
          const ItemIcon = it.icon
          return (
            <li
              key={it.key}
              className={cn(
                'flex items-start gap-3 rounded-xl border bg-card/40 px-3 py-2.5 transition-colors',
                it.done
                  ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                  : 'border-border/60 hover:border-amber-500/30',
              )}
            >
              <span className="mt-0.5">
                {it.done
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={2} aria-hidden />
                  : <Circle       className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.75} aria-hidden />}
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'flex items-center gap-1.5 text-sm font-semibold',
                  it.done && 'text-emerald-300/80 line-through decoration-emerald-500/30',
                )}>
                  <ItemIcon className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} aria-hidden />
                  {it.title}
                </p>
                {!it.done && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{it.blurb}</p>
                )}
              </div>
              {!it.done && (
                <a
                  href={it.cta.href}
                  className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/20"
                >
                  {it.cta.label}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
