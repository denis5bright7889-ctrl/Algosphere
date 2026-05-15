'use client'

import { useState } from 'react'
import type { AdminPayment } from './page'
import { cn, formatDate, formatCurrency } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: 'bg-yellow-100 text-yellow-700',
  pending_review: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-600',
}

export default function AdminPaymentCard({ payment }: { payment: AdminPayment }) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [done, setDone] = useState<{ action: 'approved' | 'rejected'; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setError(null)
    setLoading('approve')
    const res = await fetch(`/api/admin/payments/${payment.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || undefined }),
    })
    const data = await res.json()
    if (res.ok) setDone({ action: 'approved', message: data.message })
    else setError(data.error)
    setLoading(null)
  }

  async function handleReject() {
    if (!note.trim()) { setError('Rejection reason is required.'); return }
    setError(null)
    setLoading('reject')
    const res = await fetch(`/api/admin/payments/${payment.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: note }),
    })
    const data = await res.json()
    if (res.ok) setDone({ action: 'rejected', message: data.message })
    else setError(data.error)
    setLoading(null)
  }

  if (done) {
    return (
      <div className={cn(
        'rounded-xl border px-5 py-4 text-sm font-medium',
        done.action === 'approved' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
      )}>
        {done.action === 'approved' ? '✅' : '❌'} {done.message}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[payment.status] ?? '')}>
            {payment.status.replace('_', ' ')}
          </span>
          <span className="text-sm font-semibold capitalize">{payment.plan} plan</span>
          <span className="text-sm font-bold text-green-600">{formatCurrency(payment.amount_usd)}</span>
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(payment.created_at)}</span>
      </div>

      {/* Details grid */}
      <div className="px-5 py-4 grid gap-3 sm:grid-cols-2 text-sm">
        <Detail label="User" value={payment.profiles?.full_name ?? payment.user_id.slice(0, 8)} />
        <Detail label="Currency / Network" value={`${payment.currency} / ${payment.network}`} />
        <Detail label="Recipient wallet" value={payment.wallet_address} mono />
        {payment.txid && <Detail label="TXID submitted" value={payment.txid} mono />}
        {payment.admin_note && <Detail label="Note" value={payment.admin_note} />}
        {payment.reviewed_at && <Detail label="Reviewed at" value={formatDate(payment.reviewed_at)} />}
      </div>

      {/* TXID verification link */}
      {payment.txid && (
        <div className="px-5 pb-3">
          <a
            href={`https://tronscan.org/#/transaction/${payment.txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Verify on TronScan ↗
          </a>
        </div>
      )}

      {/* Actions — only for pending_review */}
      {payment.status === 'pending_review' && (
        <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}

          {showRejectForm ? (
            <div className="space-y-2">
              <textarea
                rows={2}
                placeholder="Rejection reason (required)…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={loading === 'reject'}
                  className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
                >
                  {loading === 'reject' ? 'Rejecting…' : 'Confirm reject'}
                </button>
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                rows={2}
                placeholder="Optional note for approval…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleApprove}
                  disabled={loading === 'approve'}
                  className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {loading === 'approve' ? 'Approving…' : '✓ Approve & activate'}
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-sm break-all', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  )
}
