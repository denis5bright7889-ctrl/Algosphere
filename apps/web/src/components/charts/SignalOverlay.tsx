'use client'

/**
 * Signal context card for the chart modal. Shows the latest signal for the
 * instrument: direction, entry / stop / target, R:R, confidence, and age.
 * The edge (levels) is tier-gated server-side — locked signals render an
 * upgrade nudge instead of the numbers. No active signal → honest empty
 * state (common while the engine is in dry-run).
 */
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/Skeleton'
import type { SignalContext } from '@/lib/chart-intel'

const fmt = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 5 })
    : '—'

export default function SignalOverlay({
  signal, loading,
}: {
  signal: SignalContext | null
  loading: boolean
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3.5">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Signal Context</h3>

      {loading ? (
        <SkeletonText lines={3} />
      ) : !signal || !signal.available ? (
        <p className="text-xs text-muted-foreground">No active signal for this instrument.</p>
      ) : signal.locked ? (
        <div className="space-y-2">
          <DirectionBadge direction={signal.direction} />
          <p className="text-xs text-muted-foreground">{signal.reason}</p>
          <Link href="/upgrade" className="inline-block rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/10">
            Upgrade →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <DirectionBadge direction={signal.direction} />
            <span className="text-[10px] text-muted-foreground">{signal.age_label}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <Level label="Entry"  value={fmt(signal.entry)} />
            <Level label="Stop"   value={fmt(signal.stop_loss)} tone="text-rose-400" />
            <Level label="Target" value={fmt(signal.take_profit)} tone="text-emerald-400" />
            <Level label="R:R"    value={signal.risk_reward != null ? `${signal.risk_reward.toFixed(2)}` : '—'} />
          </div>
          {signal.confidence != null && (
            <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
              <span className="text-xs text-muted-foreground">Confidence</span>
              <span className="text-xs font-semibold tabular-nums">{signal.confidence}/100</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function DirectionBadge({ direction }: { direction?: string }) {
  const buy = direction?.toLowerCase() === 'buy'
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider',
      buy ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
          : 'border-rose-500/30 bg-rose-500/15 text-rose-400',
    )}>
      {direction ?? '—'}
    </span>
  )
}

function Level({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-semibold tabular-nums', tone)}>{value}</div>
    </div>
  )
}
