import {
  TrendingUp, ArrowLeftRight, Zap, HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Regime = 'trending' | 'mean_reversion' | 'high_volatility' | 'exhaustion' | 'unknown'

interface Props {
  regime: string
  description?: string
  compact?: boolean
}

// Institutional, user-facing labels (the raw engine regime keys stay the
// map KEYS, but users only ever see these readable states — never
// 'Exhaustion'/'Unknown'/engine jargon).
const REGIME_META: Record<Regime, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  trending:        { label: 'Trending',          color: 'text-emerald-400',      bg: 'bg-emerald-500/15 border-emerald-500/30', icon: TrendingUp     },
  mean_reversion:  { label: 'Ranging',           color: 'text-sky-400',          bg: 'bg-sky-500/15 border-sky-500/30',         icon: ArrowLeftRight },
  high_volatility: { label: 'Volatile',          color: 'text-amber-400',        bg: 'bg-amber-500/15 border-amber-500/30',     icon: Zap            },
  exhaustion:      { label: 'Mixed Conditions',  color: 'text-muted-foreground', bg: 'bg-muted/20 border-border',               icon: ArrowLeftRight },
  unknown:         { label: 'Awaiting Confirmation', color: 'text-muted-foreground', bg: 'bg-muted/20 border-border',           icon: HelpCircle     },
}

function getMeta(regime: string) {
  const key = regime.toLowerCase().replace(/ /g, '_') as Regime
  return REGIME_META[key] ?? REGIME_META.unknown
}

export default function RegimeBadge({ regime, description, compact = false }: Props) {
  const meta = getMeta(regime)
  const Icon = meta.icon

  if (compact) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        meta.bg, meta.color,
      )}>
        <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        {meta.label}
      </span>
    )
  }

  return (
    <div className={cn(
      'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5',
      meta.bg,
    )}>
      <Icon className={cn('h-4 w-4', meta.color)} strokeWidth={1.75} aria-hidden />
      <div>
        <p className={cn('text-xs font-semibold', meta.color)}>{meta.label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  )
}
