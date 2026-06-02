'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, History } from 'lucide-react'

interface Summary {
  signup:           number
  broker_connected: number
  premium_upgrade:  number
  journal_created:  number
  strategy_created: number
  skipped:          number
}

export default function BackfillButton() {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<Summary | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const router = useRouter()

  function run() {
    setError(null); setResult(null)
    start(async () => {
      const res = await fetch('/api/admin/growth/backfill-funnel', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Backfill failed'); return }
      setResult(json as Summary)
      router.refresh()
    })
  }

  const inserted = result
    ? result.signup + result.broker_connected + result.premium_upgrade + result.journal_created + result.strategy_created
    : 0

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        Backfill historical events
      </button>
      {error && (
        <p className="text-[11px] text-rose-300">{error}</p>
      )}
      {result && (
        <p className="text-[11px] text-emerald-300">
          Inserted {inserted}: {result.signup} signups · {result.broker_connected} brokers · {result.premium_upgrade} upgrades · {result.journal_created} journal · {result.strategy_created} strategy
          {result.skipped > 0 && <span className="text-muted-foreground"> · skipped {result.skipped}</span>}
        </p>
      )}
    </div>
  )
}
