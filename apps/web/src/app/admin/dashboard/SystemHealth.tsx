'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface Health {
  status: string
  timestamp: string
  uptime: number | null
  services: {
    database: { status: string; latencyMs: number }
    supabase: { status: string; url: string }
    payments: { status: string; provider: string; enabled: boolean }
    adminEmail: { status: string }
  }
  metrics: { pendingPayments: number; recentActivity: number }
}

export default function SystemHealth() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  async function fetchHealth() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/health')
      if (res.ok) setHealth(await res.json())
    } finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">System Health</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            type="button"
            onClick={fetchHealth}
            className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && !health ? (
        <p className="text-sm text-muted-foreground">Checking services…</p>
      ) : !health ? (
        <p className="text-sm text-destructive">Health check failed.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ServiceRow
            label="Database"
            status={health.services.database.status}
            detail={`${health.services.database.latencyMs}ms`}
          />
          <ServiceRow
            label="Supabase"
            status={health.services.supabase.status}
            detail={health.services.supabase.url}
          />
          <ServiceRow
            label="Payments"
            status={health.services.payments.enabled ? 'ok' : 'warning'}
            detail={health.services.payments.provider}
          />
          <ServiceRow
            label="Admin Email"
            status={health.services.adminEmail.status}
            detail={health.services.adminEmail.status === 'configured' ? 'Set ✓' : 'Missing ⚠'}
          />
        </div>
      )}

      {health && (
        <div className="border-t border-border pt-3 flex flex-wrap gap-6 text-sm">
          <Metric label="Pending payments" value={health.metrics.pendingPayments} warn={health.metrics.pendingPayments > 0} />
          <Metric label="Recent activity" value={health.metrics.recentActivity} />
          {health.uptime && <Metric label="Server uptime" value={`${Math.floor(health.uptime / 60)}m`} />}
        </div>
      )}
    </div>
  )
}

function ServiceRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  const dot = status === 'ok' ? 'bg-green-500' : status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1">
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full', dot)} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function Metric({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-bold', warn ? 'text-yellow-600' : '')}>{value}</p>
    </div>
  )
}
