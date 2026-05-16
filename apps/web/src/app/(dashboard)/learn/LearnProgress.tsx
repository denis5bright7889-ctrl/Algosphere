'use client'

import { useEffect, useState } from 'react'

const KEY = 'algosphere_learn_completed'

export function getCompleted(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function markComplete(lessonId: string) {
  const set = getCompleted()
  set.add(lessonId)
  localStorage.setItem(KEY, JSON.stringify([...set]))
}

export default function LearnProgress({ total }: { total: number }) {
  const [done, setDone] = useState(0)

  useEffect(() => { setDone(getCompleted().size) }, [])

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Your Progress
        </span>
        <span className="text-sm font-bold tabular-nums text-amber-300">
          {done}/{total} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-amber-300 transition-all"
          // dynamic width is data-driven
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
