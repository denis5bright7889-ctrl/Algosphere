/**
 * /admin/command-center — institutional ops view.
 *
 * One read-only screen answering "is the whole machine running right now?":
 * worker/engine heartbeats, kill-switch/risk, signal + execution throughput,
 * broker health, the content/growth queue, top rejection reasons, and
 * user/revenue counters. Complements /admin/dashboard (which is the
 * longer-form analytics view).
 *
 * Service-role reads (admin-gated by app/admin/layout.tsx). Every query
 * degrades to empty on a missing table or transient error — supabase-js
 * returns { data: null } rather than throwing — so the page never breaks.
 */
import { createClient as serviceClient } from '@supabase/supabase-js'
import { cn, formatCurrency } from '@/lib/utils'

export const metadata = { title: 'Admin — Command Center' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Heartbeat { component: string; last_at: string | null; status: string | null }
interface EventRow  { payload_summary: { reason?: string } | null }

async function load() {
  const now = Date.now()
  const h1  = new Date(now - 3_600_000).toISOString()
  const h24 = new Date(now - 86_400_000).toISOString()

  const [
    hb, risk, sig1h, sig24h, exec24h, brokers, content, events, profiles, payments,
  ] = await Promise.all([
    db().from('engine_heartbeats').select('component, last_at, status'),
    db().from('global_risk_state').select('kill_switch, reason, state, updated_at').limit(1).maybeSingle(),
    db().from('signals').select('id', { count: 'exact', head: true }).gte('published_at', h1),
    db().from('signals').select('id', { count: 'exact', head: true }).gte('published_at', h24),
    db().from('execution_events').select('id', { count: 'exact', head: true }).gte('created_at', h24),
    db().from('broker_connections').select('status'),
    db().from('growth_content_items').select('status'),
    db().from('system_event_log').select('payload_summary')
      .in('surface', ['signal_skipped', 'signal_rejected', 'risk_block'])
      .gte('sent_at', h24).limit(5000),
    db().from('profiles').select('subscription_tier, subscription_status'),
    db().from('crypto_payments').select('amount_usd, status, created_at'),
  ])

  const heartbeats = ((hb.data ?? []) as Heartbeat[]).map((h) => ({
    ...h,
    ageSec: h.last_at ? Math.round((now - new Date(h.last_at).getTime()) / 1000) : null,
  }))

  const countBy = <T extends Record<string, unknown>>(rows: T[] | null, key: keyof T) => {
    const out: Record<string, number> = {}
    for (const r of rows ?? []) { const k = String(r[key] ?? 'unknown'); out[k] = (out[k] ?? 0) + 1 }
    return out
  }

  const brokerStatus  = countBy(brokers.data as { status: string }[] | null, 'status')
  const contentStatus = countBy(content.data as { status: string }[] | null, 'status')
  const tierCounts    = countBy(profiles.data as { subscription_tier: string }[] | null, 'subscription_tier')

  const rejFreq: Record<string, number> = {}
  for (const e of (events.data ?? []) as EventRow[]) {
    const r = e.payload_summary?.reason
    if (r) rejFreq[r] = (rejFreq[r] ?? 0) + 1
  }
  const topRejections = Object.entries(rejFreq).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const pay = (payments.data ?? []) as { amount_usd: number | null; status: string; created_at: string }[]
  const paid = pay.filter((p) => ['approved', 'completed', 'confirmed'].includes((p.status ?? '').toLowerCase()))
  const revenueTotal = paid.reduce((s, p) => s + (p.amount_usd ?? 0), 0)
  const revenue24h = paid.filter((p) => p.created_at >= h24).reduce((s, p) => s + (p.amount_usd ?? 0), 0)

  return {
    heartbeats,
    risk: risk.data as { kill_switch: boolean; reason: string | null; state: string | null; updated_at: string | null } | null,
    signals1h:  sig1h.count ?? 0,
    signals24h: sig24h.count ?? 0,
    exec24h:    exec24h.count ?? 0,
    brokerStatus, contentStatus, tierCounts, topRejections,
    revenueTotal, revenue24h,
    pendingPayments: pay.filter((p) => (p.status ?? '').toLowerCase() === 'pending').length,
    totalUsers: (profiles.data ?? []).length,
  }
}

const STALE_SEC = 600 // 10 min — a heartbeat older than this is "stale"

export default async function CommandCenterPage() {
  const d = await load()
  const killOn = d.risk?.kill_switch === true

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
          <p className="mt-1 text-xs text-muted-foreground">Real-time platform operations — workers, risk, throughput, brokers, content, revenue.</p>
        </div>
        <span className={cn(
          'rounded-full border px-3 py-1 text-xs font-bold',
          killOn ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
        )}>
          {killOn ? '● KILL SWITCH ACTIVE' : '● Trading live'}
        </span>
      </header>

      {killOn && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/[0.06] p-4 text-sm text-rose-200">
          <span className="font-semibold">Execution halted by kill switch.</span>{' '}
          {d.risk?.reason ?? 'No reason recorded.'}
        </div>
      )}

      {/* Throughput + money */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Signals · 1h"  value={d.signals1h} />
        <Tile label="Signals · 24h" value={d.signals24h} tone={d.signals24h === 0 ? 'rose' : undefined} />
        <Tile label="Executions · 24h" value={d.exec24h} />
        <Tile label="Users" value={d.totalUsers} />
        <Tile label="Revenue · 24h" value={formatCurrency(d.revenue24h)} />
        <Tile label="Revenue · total" value={formatCurrency(d.revenueTotal)} />
      </section>

      {/* Workers / heartbeats */}
      <Panel title="Workers & engine">
        {d.heartbeats.length === 0 ? (
          <Empty>No heartbeats reported — the engine may be down or `engine_heartbeats` is empty.</Empty>
        ) : (
          <ul className="divide-y divide-border/50">
            {d.heartbeats.map((h) => {
              const stale = h.ageSec == null || h.ageSec > STALE_SEC
              const down  = (h.status ?? '') === 'down'
              return (
                <li key={h.component} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', down ? 'bg-rose-400' : stale ? 'bg-amber-400' : 'bg-emerald-400')} />
                    <span className="font-mono">{h.component}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                    <span className={cn(down ? 'text-rose-300' : stale ? 'text-amber-300' : 'text-emerald-300')}>{h.status ?? '—'}</span>
                    <span>{h.ageSec == null ? 'never' : h.ageSec < 60 ? `${h.ageSec}s ago` : h.ageSec < 3600 ? `${Math.round(h.ageSec / 60)}m ago` : `${Math.round(h.ageSec / 3600)}h ago`}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Broker connections">
          <StatusBars data={d.brokerStatus} goodKeys={['connected']} />
        </Panel>
        <Panel title="Content / growth queue">
          <StatusBars data={d.contentStatus} goodKeys={['published']} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top rejection reasons · 24h" subtitle="Why signals didn't publish">
          {d.topRejections.length === 0 ? (
            <Empty>No rejections logged in the last 24h.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {d.topRejections.map(([reason, count]) => (
                <li key={reason} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-[12px] text-foreground/85">{reason}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Users by tier" subtitle={d.pendingPayments > 0 ? `${d.pendingPayments} payment(s) pending review` : undefined}>
          <StatusBars data={d.tierCounts} goodKeys={['premium', 'vip']} />
        </Panel>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Live read from Supabase ops tables. Engine-internal funnel detail is on the engine&apos;s <span className="font-mono">/api/v1/diagnostics/full</span>.
      </p>
    </div>
  )
}


// ─── presentational ─────────────────────────────────────────────────

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'rose' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'rose' && 'text-rose-300')}>{value}</div>
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </section>
  )
}

function StatusBars({ data, goodKeys }: { data: Record<string, number>; goodKeys: string[] }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <Empty>No rows.</Empty>
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1
  return (
    <ul className="space-y-2">
      {entries.map(([k, n]) => {
        const good = goodKeys.includes(k)
        const bad  = ['failed', 'error', 'down', 'revoked', 'disconnected'].includes(k)
        return (
          <li key={k} className="text-sm">
            <div className="flex items-center justify-between">
              <span className="capitalize">{k}</span>
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn('h-full rounded-full', good ? 'bg-emerald-400' : bad ? 'bg-rose-400' : 'bg-amber-400')}
                style={{ width: `${Math.round((n / total) * 100)}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>
}
