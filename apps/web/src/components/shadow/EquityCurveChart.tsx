'use client'

/**
 * EquityCurveChart — Phase 6 of the Validation Center.
 *
 * Renders the validation equity curve from points computed by
 * buildEquityCurve. Three layered series:
 *
 *   • Confidence-band area    (±1 σ × √N, suppressed below sample)
 *   • Cumulative P&L line     (primary visual)
 *   • Drawdown area below 0   (red, shows peak-to-trough underwater)
 *
 * Plus a small summary bar above the chart with net / peak / max
 * drawdown / current drawdown / rolling win rate. The whole component
 * is client-only because Recharts pulls a Canvas/SVG pipeline.
 */

import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { cn } from '@/lib/utils'
import type { CurvePoint, CurveSummary } from '@/lib/intelligence/equity-curve'

interface Props {
  points:  CurvePoint[]
  summary: CurveSummary
}

function fmtUSD(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(2)}%`
}

export default function EquityCurveChart({ points, summary }: Props) {
  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
        Equity curve appears once shadow trades close.
      </div>
    )
  }

  return (
    <div>
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        <SummaryStat
          label="Net P&L"
          value={fmtUSD(summary.net_pnl)}
          tone={summary.net_pnl >= 0 ? 'green' : 'red'}
        />
        <SummaryStat label="Peak"           value={fmtUSD(summary.peak_pnl)} tone="plain" />
        <SummaryStat label="Max Drawdown"   value={fmtUSD(-summary.max_drawdown)} tone={summary.max_drawdown > 0 ? 'amber' : 'plain'} />
        <SummaryStat
          label="Current DD"
          value={summary.current_drawdown > 0 ? `−${fmtPct(summary.max_drawdown_pct)}` : '—'}
          tone={summary.current_drawdown > 0 ? 'amber' : 'green'}
        />
        <SummaryStat
          label="Win Rate"
          value={summary.final_win_rate == null ? '—' : `${summary.final_win_rate}%`}
          tone={summary.final_win_rate == null ? 'plain'
            : summary.final_win_rate >= 55 ? 'green'
            : summary.final_win_rate >= 45 ? 'amber' : 'red'}
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-background/30 p-3">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="equity-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="equity-conf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#60a5fa" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
            <XAxis
              dataKey="x"
              tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
              axisLine={{ stroke: 'rgba(148,163,184,0.25)' }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              yAxisId="pnl"
              tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
              axisLine={{ stroke: 'rgba(148,163,184,0.25)' }}
              tickLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(148,163,184,0.4)', strokeDasharray: '3 3' }}
              contentStyle={{
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(label) => `Day: ${label}`}
              formatter={(value: number, name: string) => {
                if (name === 'cumulative_pnl')  return [fmtUSD(value), 'Cumulative']
                if (name === 'daily_pnl')       return [fmtUSD(value), 'Daily P&L']
                if (name === 'drawdown')        return [fmtUSD(-value), 'Drawdown']
                if (name === 'confidence_high') return [fmtUSD(value), '+1σ Band']
                if (name === 'confidence_low')  return [fmtUSD(value), '−1σ Band']
                if (name === 'rolling_win_rate') return [value == null ? '—' : `${value}%`, 'Rolling Win Rate']
                return [value, name]
              }}
            />

            {/* Confidence band rendered as twin areas (low + high). */}
            <Area
              yAxisId="pnl"
              type="monotone"
              dataKey="confidence_high"
              stroke="rgba(96,165,250,0.4)"
              strokeWidth={1}
              fill="url(#equity-conf)"
              fillOpacity={0.7}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              yAxisId="pnl"
              type="monotone"
              dataKey="confidence_low"
              stroke="rgba(96,165,250,0.4)"
              strokeWidth={1}
              fill="none"
              dot={false}
              isAnimationActive={false}
            />

            {/* Cumulative PnL — the headline line. */}
            <Area
              yAxisId="pnl"
              type="monotone"
              dataKey="cumulative_pnl"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#equity-gradient)"
              fillOpacity={1}
              dot={false}
              isAnimationActive={false}
            />

            {/* Drawdown as a separate line, rendered negative for visual. */}
            <Line
              yAxisId="pnl"
              type="monotone"
              dataKey={(p: CurvePoint) => -p.drawdown}
              stroke="#f43f5e"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
              name="drawdown"
            />

            <ReferenceLine
              y={0}
              yAxisId="pnl"
              stroke="rgba(148,163,184,0.4)"
              strokeDasharray="2 2"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground/80">
        Equity curve is computed from closed shadow trades (one bucket per UTC day). The blue band is the ±1σ
        confidence range around cumulative P&L; it appears once ≥10 closed trades exist. The red line tracks
        peak-to-current drawdown.
      </p>
    </div>
  )
}

function SummaryStat({ label, value, tone }: {
  label: string
  value: string
  tone:  'plain' | 'green' | 'amber' | 'red'
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 text-sm font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'amber' && 'text-amber-300',
        tone === 'red'   && 'text-rose-400',
      )}>{value}</p>
    </div>
  )
}
