'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Loader2 } from 'lucide-react'

export default function AutomationActions() {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const router = useRouter()

  function manualFire() {
    setResult(null)
    start(async () => {
      const res = await fetch('/api/automation/events', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          event_type: 'manual.fire',
          source:     'admin',
          payload: {
            topic:       'Risk per trade',
            headline:    'Why 1% risk per trade compounds — and 5% blows up',
            body:        'Risk per trade is the single most important number in trading. At 1% risk, a 10-loss streak (which happens roughly twice a year on most strategies) costs you ~10% of the account — survivable. At 5% risk, the same streak compounds to a 40% drawdown. Position-size capacity is not symmetric with profitability; it\'s asymmetric with risk-of-ruin. Run the AlgoSphere position-sizing calculator to see your specific number.',
            reading_min: 3,
          },
        }),
      })
      const j = await res.json()
      setResult(j.outcome === 'ok'
        ? `Fired — ${j.matched.length} rule(s) matched, ${j.matched.filter((m: { content_id: string | null }) => m.content_id).length} draft(s) created.`
        : `Outcome: ${j.outcome}${j.error ? ' — ' + j.error : ''}`,
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={manualFire}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Generate now (manual.fire)
      </button>
      {result && (
        <p className="text-[11px] text-muted-foreground">{result}</p>
      )}
    </div>
  )
}
