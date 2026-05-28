'use client'

/**
 * IntelligenceCard — one live intelligence unit in the Analyze grid.
 *
 * Scannable in <3s: header (title + status + confidence), a micro
 * lean/heat meter, and a single-line institutional insight. Click opens
 * the right-side ExpandDrawer (no page navigation — Analyze Mode rule).
 *
 * "Changed since last poll" is highlighted with a subtle gold ring (no
 * flashing), satisfying the live-update UX rule.
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
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.75} aria-hidden />
          <span className="truncate text-sm font-semibold">{module.name}</span>
        </span>
        <StatusIndicator status={module.status} />
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

      {/* Insight — one line, clamped */}
      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
        {module.insight}
      </p>
    </button>
  )
}
