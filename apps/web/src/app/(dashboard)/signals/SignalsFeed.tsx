'use client'

import { useRealtimeSignals } from '@/hooks/useRealtimeSignals'
import SignalCard from '@/components/dashboard/SignalCard'
import type { Signal, SubscriptionTier } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  initialSignals: Signal[]
  userTier: SubscriptionTier
  userEmail: string
  isAdmin: boolean
}

export default function SignalsFeed({ initialSignals, userTier, userEmail, isAdmin }: Props) {
  const { signals, connected } = useRealtimeSignals(initialSignals)
  const active = signals.filter(s => s.lifecycle_state === 'active' || s.status === 'active')
  const history = signals.filter(s => s.lifecycle_state !== 'active' && s.status !== 'active')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Intelligence Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {active.length} active signal{active.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500')} />
            <span className="text-muted-foreground">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
          {userTier === 'free' && !isAdmin && (
            <a href="/upgrade" className="min-h-[40px] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:px-4 touch-manipulation">
              Upgrade
            </a>
          )}
          {isAdmin && (
            <a href="/admin/signals" className="min-h-[40px] rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 sm:px-4 touch-manipulation">
              Manage <span className="hidden sm:inline">signals </span>→
            </a>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Active Opportunities
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map(signal => (
              <SignalCard key={signal.id} signal={signal} userTier={userTier} userEmail={userEmail} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Closed Positions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {history.map(signal => (
              <SignalCard key={signal.id} signal={signal} userTier={userTier} userEmail={userEmail} />
            ))}
          </div>
        </section>
      )}

      {signals.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">No signals in the feed yet.</p>
        </div>
      )}
    </div>
  )
}
