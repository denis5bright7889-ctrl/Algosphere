'use client'

import { formatCurrency } from '@/lib/utils'

interface DataPoint {
  date: string
  value: number
}

interface Props {
  data: DataPoint[]
}

export default function PnlChart({ data }: Props) {
  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Need at least 2 trades to show chart.</p>
  }

  const values = data.map((d) => d.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const range = max - min || 1

  const W = 800
  const H = 200
  const PAD = 10

  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + ((max - v) / range) * (H - PAD * 2)

  const polyline = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
  const zeroY = y(0)
  const isPositive = data[data.length - 1]!.value >= 0

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        aria-label="Cumulative P&L chart"
      >
        {/* Zero line */}
        <line
          x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY}
          stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4 4"
        />

        {/* Area fill */}
        <polygon
          points={`${x(0)},${zeroY} ${polyline} ${x(data.length - 1)},${zeroY}`}
          fill={isPositive ? 'hsl(142 76% 36% / 0.15)' : 'hsl(0 84% 60% / 0.15)'}
        />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={isPositive ? 'hsl(142 76% 36%)' : 'hsl(0 84% 60%)'}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* End dot */}
        <circle
          cx={x(data.length - 1)}
          cy={y(data[data.length - 1]!.value)}
          r="4"
          fill={isPositive ? 'hsl(142 76% 36%)' : 'hsl(0 84% 60%)'}
        />
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between text-xs text-muted-foreground mt-1 px-2">
        <span>{data[0]!.date}</span>
        <span className={`font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {formatCurrency(data[data.length - 1]!.value)}
        </span>
        <span>{data[data.length - 1]!.date}</span>
      </div>
    </div>
  )
}
