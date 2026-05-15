/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — recharts resolves at runtime on Vercel; workspace root not available locally
'use client'

import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface Props {
  signupChart: { date: string; count: number }[]
  revenueChart: { month: string; revenue: number }[]
  tierData: { name: string; value: number }[]
  signalData: { name: string; value: number }[]
}

const TIER_COLORS = ['#6b7280', '#3b82f6', '#f59e0b']
const SIGNAL_COLORS = ['#3b82f6', '#22c55e', '#ef4444']

export default function AdminCharts({ signupChart, revenueChart, tierData, signalData }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* User growth */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">User Growth (30 days)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={signupChart}>
            <defs>
              <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v: string) => `Date: ${v}`}
            />
            <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#userGrad)" strokeWidth={2} name="Signups" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Monthly Revenue (USDT)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={revenueChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, 'Revenue']}
            />
            <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tier distribution */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Plan Distribution</h2>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={tierData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`} labelLine={false}>
              {tierData.map((_, i) => (
                <Cell key={i} fill={TIER_COLORS[i % TIER_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Signal performance */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Signal Performance</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={signalData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={55} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {signalData.map((_, i) => (
                <Cell key={i} fill={SIGNAL_COLORS[i % SIGNAL_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
