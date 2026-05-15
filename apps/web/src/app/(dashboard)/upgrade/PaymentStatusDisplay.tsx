'use client'

import { useEffect, useState } from 'react'
import type { PaymentStatus } from '@/lib/payments/binance'
import { cn } from '@/lib/utils'

interface Props {
  paymentId: string
  plan: string
}

interface PaymentData {
  status: PaymentStatus
  admin_note: string | null
  amount_usd: number
  currency: string
  txid: string | null
}

const STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string; icon: string }> = {
  awaiting_payment: { label: 'Awaiting payment', color: 'text-yellow-700 bg-yellow-50 border-yellow-200', icon: '⏳' },
  pending_review: { label: 'Under review', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: '🔍' },
  approved: { label: 'Approved — Subscription active!', color: 'text-green-700 bg-green-50 border-green-200', icon: '✅' },
  rejected: { label: 'Rejected', color: 'text-red-700 bg-red-50 border-red-200', icon: '❌' },
  expired: { label: 'Expired', color: 'text-gray-600 bg-gray-50 border-gray-200', icon: '⌛' },
}

export default function PaymentStatusDisplay({ paymentId, plan }: Props) {
  const [data, setData] = useState<PaymentData | null>(null)
  const [loading, setLoading] = useState(true)

  async function poll() {
    const res = await fetch(`/api/payments/status/${paymentId}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    poll()
    // Poll every 30s while pending
    const interval = setInterval(() => {
      if (data?.status === 'pending_review' || data?.status === 'awaiting_payment') poll()
    }, 30_000)
    return () => clearInterval(interval)
  }, [paymentId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="text-center text-muted-foreground py-12 text-sm">Loading payment status…</div>
  }

  if (!data) {
    return <div className="text-center text-destructive py-12 text-sm">Payment not found.</div>
  }

  const cfg = STATUS_CONFIG[data.status]

  return (
    <div className="space-y-5">
      <h2 className="font-semibold">Payment status</h2>

      <div className={cn('rounded-xl border px-5 py-5 space-y-3', cfg.color)}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{cfg.icon}</span>
          <div>
            <p className="font-bold">{cfg.label}</p>
            <p className="text-xs capitalize opacity-80">{plan} plan · {data.amount_usd} {data.currency}</p>
          </div>
        </div>
        {data.txid && (
          <p className="text-xs font-mono break-all opacity-70">TXID: {data.txid}</p>
        )}
        {data.admin_note && (
          <p className="text-sm mt-2 border-t border-current/20 pt-2 opacity-90">
            {data.status === 'rejected' ? '❗ ' : 'ℹ️ '}{data.admin_note}
          </p>
        )}
      </div>

      {data.status === 'pending_review' && (
        <p className="text-xs text-center text-muted-foreground">
          This page refreshes automatically. Approval usually takes under 24 hours.
        </p>
      )}

      {data.status === 'approved' && (
        <a
          href="/overview"
          className="block w-full rounded-md bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Go to dashboard →
        </a>
      )}

      {(data.status === 'rejected' || data.status === 'expired') && (
        <a
          href="/upgrade"
          className="block w-full rounded-md border border-border px-4 py-3 text-center text-sm font-semibold hover:bg-accent"
        >
          Start a new payment
        </a>
      )}
    </div>
  )
}
