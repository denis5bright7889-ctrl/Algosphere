'use client'

import { cn } from '@/lib/utils'
import ProgressBar from '@/components/ui/ProgressBar'

interface Props {
  todayPnl: number
  todayRisked: number
  todayTrades: number
}

const DAILY_LIMIT_PCT = 3

export default function DailyLossTracker({ todayPnl, todayRisked, todayTrades }: Props) {
  const isNegative = todayPnl < 0
  const limitAmount = 300 // $300 default daily loss limit — user can later configure
  const usedPct = Math.min(Math.abs(Math.min(todayPnl, 0)) / limitAmount * 100, 100)

  const status =
    usedPct >= 100 ? 'danger' :
    usedPct >= 66 ? 'warning' :
    'safe'

  const statusLabel = { safe: 'Safe to trade', warning: 'Approaching limit', danger: 'Stop trading today' }
  const barColor = { safe: 'bg-green-500', warning: 'bg-yellow-500', danger: 'bg-red-500' }
  const badgeColor = {
    safe: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    danger: 'bg-red-100 text-red-700',
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Daily Loss Tracker</h2>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', badgeColor[status])}>
          {statusLabel[status]}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Today&apos;s P&L</span>
          <span className={cn('font-bold text-lg', isNegative ? 'text-red-600' : 'text-green-600')}>
            {isNegative ? '' : '+'}{todayPnl.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Capital risked today</span>
          <span className="font-medium">${todayRisked.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Trades today</span>
          <span className="font-medium">{todayTrades}</span>
        </div>
      </div>

      {/* Loss limit bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Daily loss limit (${limitAmount})</span>
          <span>{usedPct.toFixed(0)}% used</span>
        </div>
        <ProgressBar
          value={usedPct}
          className="h-3"
          barClassName={cn('transition-all duration-500', barColor[status])}
        />
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">$0</span>
          <span className="text-muted-foreground">${limitAmount}</span>
        </div>
      </div>

      {status === 'danger' && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-medium">
          Daily loss limit reached. Close all positions and stop trading for today.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Daily limit is based on trades logged in your journal for today.
        Update your risk limit in Settings.
      </p>
    </div>
  )
}
