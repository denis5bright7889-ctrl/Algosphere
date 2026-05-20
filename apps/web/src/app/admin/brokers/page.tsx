import { createServiceClient } from '@/lib/supabase/server'

export const metadata = { title: 'Broker Health — Admin' }
export const dynamic = 'force-dynamic'

interface ConnRow {
  id:                string
  user_id:           string
  broker:            string
  status:            string
  is_testnet:        boolean
  equity_usd:        number | null
  equity_updated_at: string | null
  last_synced_at:    string | null
  state_changed_at:  string | null
  error_message:     string | null
  pending_cycles:    number | null
  created_at:        string
}

/**
 * Admin broker-health dashboard.
 *
 * Aggregates broker_connections across every user so operators can
 * spot a sudden spike in FAILED rows (broker outage, key rotation,
 * vault-key drift) or a stuck PENDING (engine down). Service-role
 * read — bypasses RLS by design.
 *
 * Not real-time; reflects the most recent BrokerHealthProbe pass.
 */
export default async function AdminBrokersPage() {
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('broker_connections')
    .select(`
      id, user_id, broker, status, is_testnet, equity_usd, equity_updated_at,
      last_synced_at, state_changed_at, error_message, pending_cycles, created_at
    `)
    .neq('status', 'revoked')
    .order('state_changed_at', { ascending: false, nullsFirst: false })
    .limit(500)

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
        Failed to load broker_connections: {error.message}
      </div>
    )
  }

  const rows: ConnRow[] = data ?? []
  const counts = rows.reduce<Record<string, number>>((m, r) => {
    m[r.status] = (m[r.status] ?? 0) + 1
    return m
  }, {})

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          Broker <span className="text-gradient">Health</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Per-row state across every user. Refreshes on each request; the engine
          probes every 10 minutes and writes back here.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Connected" value={counts.connected ?? 0} tone="ok" />
        <Tile label="Pending"   value={(counts.pending ?? 0) + (counts.testing ?? 0)} tone="warn" />
        <Tile label="Failed"    value={(counts.failed ?? 0) + (counts.error ?? 0) + (counts.disconnected ?? 0)} tone="bad" />
        <Tile label="Disabled"  value={counts.disabled ?? 0} tone="muted" />
        <Tile label="Total"     value={rows.length} tone="muted" />
      </section>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[840px] text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Broker</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Env</th>
              <th className="px-3 py-2 text-right">Equity</th>
              <th className="px-3 py-2 text-left">Last sync</th>
              <th className="px-3 py-2 text-left">Last change</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-semibold capitalize">{r.broker}</td>
                <td className="px-3 py-2"><StateBadge state={r.status} cycles={r.pending_cycles ?? 0} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.is_testnet ? 'testnet' : 'LIVE'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.equity_usd != null ? `$${r.equity_usd.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  {fmt(r.last_synced_at)}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  {fmt(r.state_changed_at)}
                </td>
                <td className="px-3 py-2 max-w-[260px] truncate text-[11px] text-muted-foreground" title={r.error_message ?? ''}>
                  {r.error_message ?? '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {r.user_id.slice(0, 8)}…
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground text-xs">
                No broker connections yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const cls = {
    ok:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    warn:  'border-amber-500/40   bg-amber-500/10   text-amber-300',
    bad:   'border-rose-500/40    bg-rose-500/10    text-rose-300',
    muted: 'border-border         bg-muted/20       text-foreground/80',
  }[tone]
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function StateBadge({ state, cycles }: { state: string; cycles: number }) {
  const cls = {
    connected: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    pending:   'border-amber-500/40   bg-amber-500/10   text-amber-300',
    testing:   'border-amber-500/40   bg-amber-500/10   text-amber-300',
    failed:    'border-rose-500/40    bg-rose-500/10    text-rose-300',
    error:     'border-rose-500/40    bg-rose-500/10    text-rose-300',
    disconnected: 'border-rose-500/40 bg-rose-500/10    text-rose-300',
    disabled:  'border-zinc-500/40    bg-zinc-500/10    text-zinc-300',
  }[state] ?? 'border-border bg-muted/20 text-foreground/70'

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {state}{state === 'pending' && cycles > 0 ? ` ·${cycles}` : ''}
    </span>
  )
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleString()
  } catch {
    return ts
  }
}
