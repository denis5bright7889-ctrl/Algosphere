/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — recharts resolves at runtime on Vercel; workspace root not available locally
'use client'

/**
 * Behavior Trend chart for Psychology V3 — plots the per-period behavioral
 * timeline (one point per month/quarter) as multiple lines on a shared
 * 0–100 axis. Positive scores (maturity, discipline, self-control) and
 * risk metrics (revenge, tilt) share the axis because both are 0–100.
 *
 * Pure presentational: the parent computes the series server-side and
 * hands down already-shaped rows. Nulls render as gaps (connectNulls off)
 * so a thin period doesn't draw a fabricated line segment.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

export interface TrendRow {
  label: string
  [metric: string]: string | number | null
}
export interface TrendLine {
  key:   string
  name:  string
  color: string
}

export default function PsychologyTrendChart({ data, lines }: { data: TrendRow[]; lines: TrendLine[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={36} />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
