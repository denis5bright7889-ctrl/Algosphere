'use client'

import { useEffect, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Summary {
  total_accrued:  number
  total_approved: number
  total_paid:     number
  pending_payout: number
  by_type: {
    subscription_fee: number
    profit_share:     number
    tip:              number
  }
  subscribers_count: number
  copy_followers:    number
  top_strategy: { id: string; name: string; revenue: number } | null
}

interface EarningRow {
  id:           string
  earning_type: string
  gross_usd:    number
  creator_usd:  number
  status:       string
  created_at:   string
  paid_at:      string | null
  published_strategies: { name: string } | null
}

const TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  subscription_fee: { icon: '💳', label: 'Subscription' },
  profit_share:     { icon: '📈', label: 'Profit Share' },
  tip:              { icon: '💝', label: 'Tip'          },
}

export default function EarningsClient() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [recent, setRecent]   = useState<EarningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showPayout, setShowPayout] = useState(false)

  useEffect(() => {
    fetch('/api/social/earnings')
      .then(r => r.json())
      .then(d => {
        setSummary(d.summary)
        setRecent(d.recent ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }
  if (!summary) {
    return <div className="text-sm text-muted-foreground">No earnings data.</div>
  }

  return (
    <div className="space-y-6">
      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <StatCard
          label="Pending Payout"
          value={`$${summary.pending_payout.toFixed(2)}`}
          tone="gold"
          subtitle={summary.pending_payout >= 50 ? 'Ready to withdraw' : `$${(50 - summary.pending_payout).toFixed(2)} until $50 min`}
        />
        <StatCard
          label="Total Paid"
          value={`$${summary.total_paid.toFixed(2)}`}
          tone="green"
          subtitle="All-time payouts"
        />
        <StatCard
          label="Active Subscribers"
          value={summary.subscribers_count.toLocaleString()}
          tone="plain"
        />
        <StatCard
          label="Copy Followers"
          value={summary.copy_followers.toLocaleString()}
          tone="plain"
        />
      </div>

      {/* Payout CTA */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-bold">Request Payout</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Withdraw your accrued earnings as USDT TRC20. Minimum $50.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPayout(true)}
            disabled={summary.pending_payout < 50}
            className={cn(
              'btn-premium !py-2 !px-5 !text-sm',
              summary.pending_payout < 50 && 'opacity-40 cursor-not-allowed',
            )}
          >
            Request Withdrawal
          </button>
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
          Revenue Breakdown
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['subscription_fee','profit_share','tip'] as const).map(t => {
            const meta = TYPE_LABELS[t]!
            return (
              <div key={t} className="rounded-xl border border-border/60 bg-background/50 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums">
                  ${summary.by_type[t].toFixed(2)}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top strategy */}
      {summary.top_strategy && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Top Earning Strategy
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-semibold">{summary.top_strategy.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lifetime revenue
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-amber-300">
              ${summary.top_strategy.revenue.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Recent earnings */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <h3 className="px-5 py-3 text-xs uppercase tracking-widest text-muted-foreground border-b border-border">
          Recent Earnings
        </h3>
        {recent.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No earnings yet. Publish a strategy to start earning.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider border-b border-border/50">
                <th className="px-5 py-2.5 font-medium">Type</th>
                <th className="px-5 py-2.5 font-medium">Strategy</th>
                <th className="px-5 py-2.5 font-medium text-right">Gross</th>
                <th className="px-5 py-2.5 font-medium text-right">Your Cut</th>
                <th className="px-5 py-2.5 font-medium text-right">Status</th>
                <th className="px-5 py-2.5 font-medium text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10">
                  <td className="px-5 py-2.5">
                    {TYPE_LABELS[r.earning_type]?.icon} {TYPE_LABELS[r.earning_type]?.label ?? r.earning_type}
                  </td>
                  <td className="px-5 py-2.5 truncate max-w-[200px]">
                    {r.published_strategies?.name ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                    ${Number(r.gross_usd).toFixed(2)}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-semibold">
                    ${Number(r.creator_usd).toFixed(2)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPayout && (
        <PayoutModal
          amount={summary.pending_payout}
          onClose={() => setShowPayout(false)}
          onSuccess={() => {
            setShowPayout(false)
            // Refresh
            fetch('/api/social/earnings').then(r => r.json()).then(d => {
              setSummary(d.summary)
              setRecent(d.recent ?? [])
            })
          }}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, tone, subtitle }: {
  label: string; value: string; tone: 'gold' | 'green' | 'plain'; subtitle?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-2xl font-bold tabular-nums',
        tone === 'gold'  && 'text-amber-300 glow-text-gold',
        tone === 'green' && 'text-emerald-400',
      )}>
        {value}
      </p>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls = {
    accrued:  'text-amber-300 bg-amber-500/10 border-amber-500/30',
    approved: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
    paid:     'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    disputed: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
    voided:   'text-muted-foreground bg-muted/30 border-border',
  }[status] ?? 'border-border bg-muted/30'

  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize',
      cls,
    )}>
      {status}
    </span>
  )
}

function PayoutModal({ amount, onClose, onSuccess }: {
  amount: number; onClose: () => void; onSuccess: () => void
}) {
  const [wallet, setWallet] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    if (wallet.length < 20) {
      setError('Invalid wallet address')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/social/payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_address: wallet, network: 'TRC20' }),
        })
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error ?? 'Failed')
        }
        onSuccess()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="rounded-2xl border border-border bg-card p-6 max-w-md w-full">
        <h2 className="text-lg font-bold mb-1">Request Payout</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Withdraw <span className="font-bold text-amber-300">${amount.toFixed(2)}</span> as USDT TRC20.
        </p>

        <label className="block text-xs text-muted-foreground mb-1.5">
          TRC20 Wallet Address
        </label>
        <input
          type="text"
          value={wallet}
          onChange={e => setWallet(e.target.value.trim())}
          placeholder="T..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500/40"
        />
        <p className="text-[10px] text-muted-foreground mt-2">
          Double-check this address. Crypto sends are irreversible.
        </p>

        {error && <p className="text-xs text-rose-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || wallet.length < 20}
            className={cn(
              'btn-premium !py-2 !px-5 !text-xs',
              (pending || wallet.length < 20) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {pending ? 'Requesting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
