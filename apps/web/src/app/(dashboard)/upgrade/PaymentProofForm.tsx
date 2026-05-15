'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Session {
  payment_id: string
  wallet_address: string
  amount_usd: number
  currency: string
  network: string
  plan: string
}

interface Props {
  session: Session
  onSubmitted: () => void
  onBack: () => void
}

export default function PaymentProofForm({ session, onSubmitted, onBack }: Props) {
  const [txid, setTxid] = useState('')
  const [amountSent, setAmountSent] = useState(String(session.amount_usd))
  const [senderWallet, setSenderWallet] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setLoading(true)

    const body = {
      payment_id: session.payment_id,
      txid: txid.trim(),
      amount_sent: parseFloat(amountSent),
      sender_wallet: senderWallet.trim() || undefined,
    }

    const res = await fetch('/api/payments/submit-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) {
      if (typeof data.error === 'object') {
        setFieldErrors(data.error)
      } else {
        setError(data.error ?? 'Submission failed')
      }
      setLoading(false)
      return
    }

    onSubmitted()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <h2 className="font-semibold">Submit payment proof</h2>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-1">
        <p><span className="text-muted-foreground">Plan:</span> <strong className="capitalize">{session.plan}</strong></p>
        <p><span className="text-muted-foreground">Amount:</span> <strong>{session.amount_usd} USDT</strong></p>
        <p><span className="text-muted-foreground">Network:</span> <strong>{session.network}</strong></p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">
            Transaction ID (TXID) <span className="text-destructive">*</span>
          </label>
          <input
            required
            value={txid}
            onChange={(e) => setTxid(e.target.value)}
            placeholder="e.g. a1b2c3d4e5f6... (60–80 hex characters)"
            className={cn(inputCls, fieldErrors.txid && 'border-destructive')}
          />
          {fieldErrors.txid && (
            <p className="text-xs text-destructive">{fieldErrors.txid[0]}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Find this in your Binance withdrawal history or TronScan.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">
            Amount sent (USDT) <span className="text-destructive">*</span>
          </label>
          <input
            required
            type="number"
            step="0.01"
            value={amountSent}
            onChange={(e) => setAmountSent(e.target.value)}
            className={cn(inputCls, fieldErrors.amount_sent && 'border-destructive')}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">
            Your sending wallet address <span className="text-muted-foreground text-xs">(optional)</span>
          </label>
          <input
            value={senderWallet}
            onChange={(e) => setSenderWallet(e.target.value)}
            placeholder="TRC20 address you sent from"
            className={inputCls}
          />
        </div>

        <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Submitting false TXIDs will result in permanent account suspension.
          All transactions are verified on-chain via TronScan.
        </div>

        <button
          type="submit"
          disabled={loading}
          className={cn(
            'w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors',
            loading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {loading ? 'Submitting…' : 'Submit payment proof'}
        </button>
      </form>
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono'
