'use client'

/**
 * IntelligenceCard — one live intelligence unit in the Analyze grid.
 *
 * V2 (Reliability layer): the card now consumes the SANITIZED user-
 * facing fields (`reasoning`, `source_quality`, `freshness`,
 * `userStatus`) and never the raw `insight`. Provider names + HTTP
 * codes + credit/quota wording can no longer reach the screen — they
 * stay on `module.insight` for the admin diagnostics surface only.
 */
import {
  Radar, Rocket, BarChart3, Sparkles, Waves, PieChart, Activity, Network, Cpu, BrainCircuit,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntelligenceModule } from '@/lib/intelligence/grid-types'
import StatusIndicator from './StatusIndicator'
import ConfidenceBadge from './ConfidenceBadge'
import SignalMeter from './SignalMeter'
import SourceQualityPill from './SourceQualityPill'
import FreshnessPill from './FreshnessPill'

const ICON: Record<string, LucideIcon> = {
  regime: Radar, momentum: Rocket, breadth: BarChart3, smartMoney: Sparkles,
  whaleFlow: Waves, dominance: PieChart, volatility: Activity,
  correlation: Network, execution: Cpu,
}

export default function IntelligenceCard({
  module, changed = false, onExpand,
}: {
  module: IntelligenceModule
  changed?: boolean
  onExpand: (m: IntelligenceModule) => void
}) {
  const Icon = ICON[module.key] ?? BrainCircuit
  return (
    <button
      type="button"
      onClick={() => onExpand(module)}
      aria-label={`${module.name} — open full breakdown`}
      className={cn(
        'group flex h-full w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all',
        'hover:border-primary/40 hover:bg-card/80 focus-visible:border-primary/50',
        changed ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border/70',
      )}
    >
      {/* Header — name + direction status */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.75} aria-hidden />
          <span className="truncate text-sm font-semibold">{module.name}</span>
        </span>
        <StatusIndicator status={module.status} userStatus={module.userStatus} />
      </div>

      {/* Micro-viz + confidence */}
      <div className="flex items-center gap-3">
        <SignalMeter
          lean={module.lean} strength={module.confidence / 100}
          directional={module.directional} available={module.available}
          className="flex-1"
        />
        <ConfidenceBadge value={module.confidence} available={module.available} />
      </div>

      {/* Sanitized reasoning — never raw provider error text */}
      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
        {module.reasoning}
      </p>

      {/* Footer — source quality + freshness affordances. Per the founder
          rule, this row is how users learn to weight the read — without
          ever seeing provider names. */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <SourceQualityPill quality={module.source_quality} />
        <FreshnessPill freshness={module.freshness} userStatus={module.userStatus} />
      </div>
    </button>
  )
}
