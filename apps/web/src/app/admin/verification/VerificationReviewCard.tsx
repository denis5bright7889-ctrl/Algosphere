'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Row {
  user_id:              string
  tier:                 string
  application_status:   string
  broker_name:          string | null
  broker_statement_url: string | null
  mt5_account_id:       string | null
  applied_at:           string | null
  verified_at:          string | null
  rejected_at:          string | null
  rejection_reason:     string | null
  live_trade_count:     number | null
  live_win_rate:        number | null
  profiles: { public_handle: string | null; bio: string | null } | null
  trader_scores: {
    composite_score:  number | null
    win_rate:         number | null
    sharpe_ratio:     number | null
    total_trades:     number | null
    max_drawdown_pct: number | null
  } | null
}

export default function VerificationReviewCard({ row }: { row: Row }) {
  const [pending, startTransition] = useTransition()
  const [done, setDone]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  const scores = row.trader_scores
  const handle = row.profiles?.public_handle ?? 'unknown'
  const isPending = row.application_status === 'pending_verified'

  function decide(action: 'approve' | 'reject' | 'approve_elite') {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/verification/${row.user_id}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            action,
            rejection_reason: action === 'reject' ? rejectReason : undefined,
          }),
        })
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error ?? 'Failed')
        }
        setDone(action)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4 text-sm text-emerald-300">
        ✓ @{handle} — {done.replace('_', ' ')} applied.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <a
              href={`/traders/${handle}`}
              target="_blank"
              rel="noreferrer"
              className="text-base font-bold hover:text-amber-300"
            >
              @{handle}
            </a>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize',
              row.tier === 'verified' ? 'border-emerald-500/40 text-emerald-300'
              : row.tier === 'elite'  ? 'border-amber-500/40 text-amber-300'
              : 'border-border text-muted-foreground',
            )}>
              {row.tier}
            </span>
          </div>
          {row.profiles?.bio && (
            <p className="text-xs text-muted-foreground mt-1">{row.profiles.bio}</p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {row.applied_at ? `Applied ${new Date(row.applied_at).toLocaleDateString()}` : '—'}
        </span>
      </div>

      {/* Track record */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 text-center text-xs">
        <Metric label="Composite" value={scores?.composite_score?.toFixed(0) ?? '—'} />
        <Metric label="Win Rate"  value={scores?.win_rate != null ? `${scores.win_rate}%` : '—'} />
        <Metric label="Sharpe"    value={scores?.sharpe_ratio?.toFixed(2) ?? '—'} />
        <Metric label="Trades"    value={String(scores?.total_trades ?? 0)} />
        <Metric label="Max DD"    value={scores?.max_drawdown_pct != null ? `${scores.max_drawdown_pct}%` : '—'} />
      </div>

      {/* Application details */}
      <div className="rounded-lg border border-border/60 bg-background/40 p-3 mb-4 space-y-1.5 text-xs">
        <Detail label="Broker" value={row.broker_name ?? '—'} />
        <Detail label="MT5 Account" value={row.mt5_account_id ?? '—'} />
        <div className="flex justify-between items-baseline">
          <span className="text-muted-foreground">Statement</span>
          {row.broker_statement_url ? (
            <a
              href={row.broker_statement_url}
              target="_blank"
              rel="noreferrer"
              className="text-amber-300 hover:underline truncate max-w-[60%]"
            >
              View document ↗
            </a>
          ) : (
            <span className="text-muted-foreground">Not provided</span>
          )}
        </div>
        {row.rejection_reason && (
          <Detail label="Prev. rejection" value={row.rejection_reason} />
        )}
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {isPending && (
        <>
          {showReject ? (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={2}
                placeholder="Rejection reason (shown to the trader)"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:border-rose-500/40"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowReject(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/30"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => decide('reject')}
                  disabled={pending || rejectReason.length < 5}
                  className={cn(
                    'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400',
                    (pending || rejectReason.length < 5) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  Confirm Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowReject(true)}
                disabled={pending}
                className="rounded-lg border border-rose-500/30 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => decide('approve')}
                disabled={pending}
                className={cn('btn-premium !py-2 !px-4 !text-xs', pending && 'opacity-60')}
              >
                {pending ? 'Applying…' : 'Approve Verified'}
              </button>
            </div>
          )}
        </>
      )}

      {row.tier === 'verified' && !isPending && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => decide('approve_elite')}
            disabled={pending}
            className={cn(
              'rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300',
              pending && 'opacity-60',
            )}
          >
            {pending ? 'Applying…' : '🏆 Promote to Elite'}
          </button>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-bold tabular-nums">{value}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  )
}
