'use client'

import { cn } from '@/lib/utils'

interface Props {
  score: number      // 0–100
  tier?: string      // blocked | normal | aggressive | exceptional
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const TIER_COLORS: Record<string, string> = {
  blocked:     'text-red-400',
  normal:      'text-yellow-400',
  aggressive:  'text-blue-400',
  exceptional: 'text-emerald-400',
}

const TIER_BG: Record<string, string> = {
  blocked:     'bg-red-500',
  normal:      'bg-yellow-500',
  aggressive:  'bg-blue-500',
  exceptional: 'bg-emerald-500',
}

function scoreToTier(score: number): string {
  if (score < 50)  return 'blocked'
  if (score < 65)  return 'normal'
  if (score < 80)  return 'aggressive'
  return 'exceptional'
}

const SIZE = {
  sm: { ring: 48, stroke: 4, text: 'text-xs' },
  md: { ring: 64, stroke: 5, text: 'text-sm' },
  lg: { ring: 88, stroke: 6, text: 'text-base' },
}

export default function ConfidenceGauge({ score, tier, size = 'md', showLabel = true }: Props) {
  const effectiveTier = tier || scoreToTier(score)
  const { ring, stroke, text } = SIZE[size]
  const r = (ring - stroke * 2) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (Math.min(score, 100) / 100) * circumference
  const cx = ring / 2

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: ring, height: ring }}>
        <svg width={ring} height={ring} className="-rotate-90">
          {/* Track */}
          <circle
            cx={cx} cy={cx} r={r}
            stroke="currentColor"
            strokeWidth={stroke}
            fill="none"
            className="text-muted/20"
          />
          {/* Progress */}
          <circle
            cx={cx} cy={cx} r={r}
            stroke="currentColor"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn('transition-all duration-500', TIER_COLORS[effectiveTier])}
          />
        </svg>
        {/* Score label in center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('font-bold tabular-nums', text, TIER_COLORS[effectiveTier])}>
            {score}
          </span>
        </div>
      </div>

      {showLabel && (
        <span className={cn('text-xs font-medium capitalize', TIER_COLORS[effectiveTier])}>
          {effectiveTier}
        </span>
      )}
    </div>
  )
}


// Compact pill variant for use inside cards
export function ConfidencePill({ score, tier }: { score: number; tier?: string }) {
  const effectiveTier = tier || scoreToTier(score)
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-white',
      TIER_BG[effectiveTier],
    )}>
      <span className="opacity-80">C</span>
      {score}
    </span>
  )
}
