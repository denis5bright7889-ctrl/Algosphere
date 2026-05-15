'use client'

import type { DrawdownPoint } from '@/lib/types'

interface Props {
  data: DrawdownPoint[]
}

export default function DrawdownChart({ data }: Props) {
  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Need at least 2 trades to show drawdown.</p>
  }

  const W = 800
  const H = 150
  const PAD = 10
  const minDD = Math.min(...data.map(d => d.drawdown_pct), -0.1)

  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + ((0 - v) / (0 - minDD)) * (H - PAD * 2)

  const polyline = data.map((d, i) => `${x(i)},${y(d.drawdown_pct)}`).join(' ')
  const zeroY = PAD

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" aria-label="Drawdown chart">
        {/* Zero line */}
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="hsl(var(--border))" strokeWidth="1" />

        {/* Area fill */}
        <polygon
          points={`${x(0)},${zeroY} ${polyline} ${x(data.length - 1)},${zeroY}`}
          fill="hsl(0 84% 60% / 0.2)"
        />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="hsl(0 84% 60%)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground mt-1 px-2">
        <span>{data[0]?.date}</span>
        <span className="text-red-600 font-semibold">Max DD: {Math.abs(minDD).toFixed(1)}%</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}
