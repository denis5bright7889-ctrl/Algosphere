import type { Signal, SubscriptionTier } from '@/lib/types'
import { canAccess } from '@/lib/admin'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from '@/lib/signals/lifecycle'
import { GRADE_COLORS } from '@/lib/signals/quality'
import { cn, formatDate } from '@/lib/utils'

interface Props {
  signal: Signal
  userTier: SubscriptionTier
  userEmail?: string
}

export default function SignalCard({ signal, userTier, userEmail }: Props) {
  const hasAccess = canAccess(userEmail, userTier, signal.tier_required)

  if (!hasAccess) {
    return (
      <div className="relative rounded-xl border border-border bg-card p-5 overflow-hidden min-h-[180px]">
        <div className="blur-sm pointer-events-none select-none space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">●●●●●</span>
            <span className="rounded-full bg-gray-200 px-3 py-0.5 text-xs">???</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm text-muted-foreground">
            <div><p className="text-xs">Entry</p><p>—</p></div>
            <div><p className="text-xs">SL</p><p>—</p></div>
            <div><p className="text-xs">TP1</p><p>—</p></div>
          </div>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm">
          <span className="text-2xl mb-2">🔒</span>
          <p className="text-sm font-semibold capitalize">{signal.tier_required} plan required</p>
          <a href="/upgrade" className="mt-3 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
            Upgrade access
          </a>
        </div>
      </div>
    )
  }

  const isBuy = signal.direction === 'buy'
  const lifecycleState = signal.lifecycle_state ?? 'active'
  const grade = signal.quality_score != null ? qualityGrade(signal.quality_score) : null

  return (
    <div className={cn(
      'card-premium relative overflow-hidden p-4 sm:p-5 space-y-3 animate-slide-up',
      lifecycleState === 'active' && (isBuy
        ? 'shadow-glow-emerald'
        : 'shadow-glow-red'),
    )}>
      {/* Direction accent strip */}
      <div className={cn(
        'absolute inset-x-0 top-0 h-px',
        isBuy ? 'bg-gradient-emerald' : 'bg-gradient-rose',
      )} aria-hidden />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-lg tracking-tight">{signal.pair}</span>
          <span className={cn(
            'rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-white',
            isBuy ? 'bg-gradient-emerald shadow-glow-emerald' : 'bg-gradient-rose shadow-glow-red',
            lifecycleState === 'active' && 'animate-pulse-soft',
          )}>
            {signal.direction}
          </span>
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', LIFECYCLE_COLORS[lifecycleState] ?? '')}>
            {LIFECYCLE_LABELS[lifecycleState] ?? lifecycleState}
          </span>
        </div>
        {grade && (
          <span className={cn('shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide', GRADE_COLORS[grade])}>
            {grade}
          </span>
        )}
      </div>

      {/* Price levels */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Entry</p>
          <p className="font-semibold">{signal.entry_price ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Stop Loss</p>
          <p className="font-semibold text-red-600">{signal.stop_loss ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">TP 1</p>
          <p className="font-semibold text-green-600">{signal.take_profit_1 ?? '—'}</p>
        </div>
        {signal.take_profit_2 && (
          <div>
            <p className="text-xs text-muted-foreground">TP 2</p>
            <p className="font-semibold text-green-600">{signal.take_profit_2}</p>
          </div>
        )}
        {signal.take_profit_3 && (
          <div>
            <p className="text-xs text-muted-foreground">TP 3</p>
            <p className="font-semibold text-green-600">{signal.take_profit_3}</p>
          </div>
        )}
        {signal.risk_reward && (
          <div>
            <p className="text-xs text-muted-foreground">R:R</p>
            <p className="font-semibold">1:{signal.risk_reward}</p>
          </div>
        )}
      </div>

      {/* Intelligence metadata */}
      {(signal.confidence_score != null || signal.regime || signal.session) && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          {signal.confidence_score != null && (
            <ConfidencePill score={signal.confidence_score} />
          )}
          {signal.regime && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{signal.regime}</span>
          )}
          {signal.session && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{signal.session.replace('_', '/')}</span>
          )}
          {signal.quality_score != null && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Q: {signal.quality_score}/10</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
        <span>{formatDate(signal.published_at)}</span>
        {signal.pips_gained != null && (
          <span className={cn('font-semibold', signal.pips_gained >= 0 ? 'text-green-600' : 'text-red-600')}>
            {signal.pips_gained >= 0 ? '+' : ''}{signal.pips_gained} pips
          </span>
        )}
      </div>
    </div>
  )
}

function ConfidencePill({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                score >= 65 ? 'bg-blue-100 text-blue-700' :
                score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', color)}>
      {score}% conf
    </span>
  )
}

function qualityGrade(score: number): keyof typeof GRADE_COLORS {
  if (score >= 8.5) return 'A+'
  if (score >= 7.5) return 'A'
  if (score >= 6.5) return 'B+'
  if (score >= 5.5) return 'B'
  if (score >= 4.5) return 'C'
  if (score >= 3.0) return 'D'
  return 'F'
}
