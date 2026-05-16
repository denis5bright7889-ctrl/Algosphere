import type { LucideIcon } from 'lucide-react'
import AnimatedNumber from '@/components/ui/AnimatedNumber'

type Tone = 'neutral' | 'gold' | 'emerald' | 'rose'

const VALUE_TONE: Record<Tone, string> = {
  neutral: 'text-foreground',
  gold:    'text-amber-300 glow-text-gold',
  emerald: 'text-emerald-400 glow-text-emerald',
  rose:    'text-rose-400 glow-text-rose',
}

const STRIP_TONE: Record<Tone, string> = {
  neutral: 'bg-gradient-primary opacity-40',
  gold:    'bg-gradient-primary',
  emerald: 'bg-gradient-emerald',
  rose:    'bg-gradient-rose',
}

/** Compact telemetry tile. Numeric values animate; text values render flat. */
export default function Kpi({
  label, value, icon: Icon, tone = 'neutral',
  prefix, suffix, decimals = 0, text,
}: {
  label:     string
  value?:    number
  text?:     string
  icon:      LucideIcon
  tone?:     Tone
  prefix?:   string
  suffix?:   string
  decimals?: number
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 glass p-3 sm:p-4">
      <div className={'absolute inset-x-0 top-0 h-px ' + STRIP_TONE[tone]} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] sm:text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.75} aria-hidden />
      </div>
      <p className={'mt-1.5 truncate text-lg sm:text-2xl font-bold tabular-nums ' + VALUE_TONE[tone]}>
        {text != null ? (
          text
        ) : (
          <AnimatedNumber
            value={value ?? 0}
            prefix={prefix}
            suffix={suffix}
            decimals={decimals}
            duration={900}
          />
        )}
      </p>
    </div>
  )
}
