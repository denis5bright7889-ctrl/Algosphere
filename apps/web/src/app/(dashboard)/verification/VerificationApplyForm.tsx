'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

export default function VerificationApplyForm() {
  const [open, setOpen] = useState(false)
  const [broker, setBroker]         = useState('')
  const [statementUrl, setStmtUrl]  = useState('')
  const [mt5Id, setMt5Id]           = useState('')
  const [pending, startTransition]  = useTransition()
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState(false)

  function submit() {
    setError(null)
    if (broker.length < 2)       return setError('Broker name required')
    if (!statementUrl.startsWith('http')) return setError('Provide a valid statement URL')

    startTransition(async () => {
      try {
        const res = await fetch('/api/social/verification', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            broker_name:          broker,
            broker_statement_url: statementUrl,
            mt5_account_id:       mt5Id || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        setSuccess(true)
        setTimeout(() => window.location.reload(), 2000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-premium !text-xs !py-2 !px-4 mt-2"
      >
        Apply for Verified Tier
      </button>
    )
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-xs text-emerald-300 mt-3">
        ✓ Application submitted. Review takes 3–5 business days. You&apos;ll get a notification.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-4 mt-3 space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Broker Name
        </label>
        <input
          type="text"
          value={broker}
          onChange={e => setBroker(e.target.value)}
          placeholder="e.g. IC Markets, Pepperstone, Binance"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Statement URL <span className="opacity-60">(MT5 myfxbook / verified link)</span>
        </label>
        <input
          type="url"
          value={statementUrl}
          onChange={e => setStmtUrl(e.target.value)}
          placeholder="https://www.myfxbook.com/members/..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Upload your MT5 statement PDF to a public link (Google Drive, Dropbox, myfxbook).
        </p>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          MT5 Account ID <span className="opacity-60">(optional, for auto-sync)</span>
        </label>
        <input
          type="text"
          value={mt5Id}
          onChange={e => setMt5Id(e.target.value)}
          placeholder="e.g. 12345678"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
        />
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted/30"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={cn(
            'btn-premium !py-1.5 !px-4 !text-xs',
            pending && 'opacity-60 cursor-wait',
          )}
        >
          {pending ? 'Submitting…' : 'Submit Application'}
        </button>
      </div>
    </div>
  )
}
