/**
 * Admin · Broker Ownership review — the surface for the anti-sharing
 * registry. Lists every broker_account_ownership row with its computed
 * risk score, the broker_connections rows pointing at it, the user_ids
 * that have attempted to claim it (= contention), and the last 20
 * history events. Click-to-act: force-transfer or revoke (via Actions).
 *
 * Server component (gated by isAdmin / ADMIN_EMAIL), service-role reads.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { scoreOwnership, type HistoryEvent, type RiskBand } from '@/lib/broker-risk-score'
import Actions from './Actions'

export const dynamic = 'force-dynamic'

interface OwnershipRow {
  fingerprint: string; broker: string; owner_user_id: string
  ownership_status: string; unlink_cooldown_until: string | null
  linked_at: string; last_seen_at: string | null; last_seen_ip: string | null
  risk_score: number
}
interface ConnRow { id: string; user_id: string; broker_account_fingerprint: string | null; broker: string; status: string; label: string | null }
interface HistRow extends HistoryEvent {
  fingerprint: string; previous_owner_user_id: string | null
  new_owner_user_id: string | null; reason: string | null
}

const fmtTime = (v: string | null) => v ? new Date(v).toLocaleString() : '—'
const bandClass = (b: RiskBand) =>
  b === 'CRITICAL' ? 'bg-red-500/20 text-red-300 border-red-500/40'
  : b === 'HIGH'   ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
  : b === 'MEDIUM' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'

export default async function BrokerOwnershipAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAdmin(user.email)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Admin access required. Set <code>ADMIN_EMAIL</code> in env.
        </p>
      </main>
    )
  }

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [ownRes, connRes, histRes] = await Promise.all([
    svc.from('broker_account_ownership')
       .select('fingerprint, broker, owner_user_id, ownership_status, unlink_cooldown_until, linked_at, last_seen_at, last_seen_ip, risk_score')
       .limit(500),
    svc.from('broker_connections')
       .select('id, user_id, broker_account_fingerprint, broker, status, label')
       .limit(5000),
    svc.from('broker_ownership_history')
       .select('action, fingerprint, ip_address, user_agent, created_at, previous_owner_user_id, new_owner_user_id, reason')
       .gte('created_at', since).limit(5000),
  ])
  const ownerships = (ownRes.data  ?? []) as unknown as OwnershipRow[]
  const conns      = (connRes.data ?? []) as unknown as ConnRow[]
  const history    = (histRes.data ?? []) as unknown as HistRow[]

  const connsByFp: Record<string, ConnRow[]> = {}
  for (const c of conns) if (c.broker_account_fingerprint)
    (connsByFp[c.broker_account_fingerprint] ??= []).push(c)
  const histByFp: Record<string, HistRow[]> = {}
  for (const h of history) (histByFp[h.fingerprint] ??= []).push(h)

  const rows = ownerships.map(o => {
    const events = histByFp[o.fingerprint] ?? []
    const risk   = scoreOwnership(events)
    if (risk.score !== o.risk_score) {
      svc.from('broker_account_ownership')
        .update({ risk_score: risk.score, risk_flags: risk.flags })
        .eq('fingerprint', o.fingerprint).then(() => {}, () => {})
    }
    const fpConns   = connsByFp[o.fingerprint] ?? []
    const contention = new Set<string>()
    for (const c of fpConns) if (c.user_id !== o.owner_user_id) contention.add(c.user_id)
    for (const h of events)
      if (h.action === 'reclaim_blocked' && h.new_owner_user_id && h.new_owner_user_id !== o.owner_user_id)
        contention.add(h.new_owner_user_id)
    return { o, risk, fpConns, contention: Array.from(contention),
             recent: events.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0, 8) }
  }).sort((a,b) => b.risk.score - a.risk.score)

  const counts = {
    total:     rows.length,
    contended: rows.filter(r => r.contention.length > 0).length,
    critical:  rows.filter(r => r.risk.band === 'CRITICAL').length,
    high:      rows.filter(r => r.risk.band === 'HIGH').length,
    cooldown:  rows.filter(r => r.o.ownership_status === 'cooldown').length,
  }
  const orphans = conns.filter(c => !c.broker_account_fingerprint)

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin · Broker Ownership</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Anti-sharing registry. Rows are sorted by risk score; contention column lists user_ids that have attempted to claim a fingerprint they don&apos;t own.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total"     value={String(counts.total)} />
        <Kpi label="Contended" value={String(counts.contended)} cls={counts.contended ? 'text-amber-400' : 'text-muted-foreground'} />
        <Kpi label="Critical"  value={String(counts.critical)}  cls={counts.critical ? 'text-red-400'   : 'text-muted-foreground'} />
        <Kpi label="High"      value={String(counts.high)}      cls={counts.high     ? 'text-orange-400': 'text-muted-foreground'} />
        <Kpi label="In cooldown" value={String(counts.cooldown)} />
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-base font-medium">Ownerships</h2>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No ownership rows yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(({ o, risk, fpConns, contention, recent }) => (
              <details key={o.fingerprint} className="rounded-lg border bg-background/40 p-3 text-xs open:bg-background/60" open={risk.band !== 'LOW' || contention.length > 0}>
                <summary className="flex flex-wrap items-center gap-3 cursor-pointer list-none">
                  <span className={`rounded border px-2 py-0.5 font-semibold uppercase ${bandClass(risk.band)}`}>
                    {risk.band} · {risk.score}
                  </span>
                  <code className="font-mono">{o.broker}</code>
                  <code className="font-mono text-[10px] text-muted-foreground">{o.fingerprint.slice(0, 12)}…</code>
                  <span>owner <code className="font-mono">{o.owner_user_id.slice(0, 8)}</code></span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${o.ownership_status === 'cooldown' ? 'bg-amber-500/15 text-amber-400' : o.ownership_status === 'revoked' ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                    {o.ownership_status}
                  </span>
                  {contention.length > 0 && (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">
                      {contention.length} other user(s) attempted to claim
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">linked {fmtTime(o.linked_at)}</span>
                </summary>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Connections ({fpConns.length})</h3>
                    {fpConns.length === 0 ? <p className="text-muted-foreground">None tagged.</p> : (
                      <ul className="space-y-1">
                        {fpConns.map(c => (
                          <li key={c.id} className="flex items-center gap-2 rounded border px-2 py-1">
                            <code className="font-mono">{c.user_id.slice(0,8)}</code>
                            <span className={c.user_id === o.owner_user_id ? 'text-emerald-400' : 'text-amber-400'}>
                              {c.user_id === o.owner_user_id ? 'owner' : 'OTHER USER'}
                            </span>
                            <span className="ml-auto text-muted-foreground">{c.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h3 className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Contention ({contention.length})</h3>
                    {contention.length === 0 ? <p className="text-muted-foreground">None.</p> : (
                      <ul className="space-y-1">
                        {contention.map(uid => (
                          <li key={uid} className="rounded border bg-amber-500/5 px-2 py-1">
                            <code className="font-mono">{uid}</code>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h3 className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Risk flags</h3>
                    <ul className="text-[11px]">
                      {Object.entries(risk.flags).map(([k, v]) => (
                        <li key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Recent history</h3>
                    {recent.length === 0 ? <p className="text-muted-foreground">No events in the last 30 days.</p> : (
                      <ul className="space-y-1">
                        {recent.map((h, i) => (
                          <li key={i} className="rounded border px-2 py-1">
                            <span className="font-medium">{h.action}</span>
                            {h.reason && <span className="text-muted-foreground"> · {h.reason}</span>}
                            {h.new_owner_user_id && <span className="text-muted-foreground"> · new <code className="font-mono">{h.new_owner_user_id.slice(0,8)}</code></span>}
                            <span className="ml-auto block text-[10px] text-muted-foreground">{fmtTime(h.created_at)} {h.ip_address ? `· ${h.ip_address}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <Actions fingerprint={o.fingerprint} ownerUserId={o.owner_user_id} contention={contention} />
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-base font-medium">Unfingerprinted connections ({orphans.length})</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Pre-migration broker_connections that didn&apos;t get fingerprinted. The backfill leaves these unset when a fingerprint is already owned by another user — see <code>broker_ownership_history</code> with <code>reason=&apos;backfill_collision&apos;</code> above.
        </p>
        {orphans.length === 0 ? <p className="text-xs text-muted-foreground">None — everything is fingerprinted.</p> : (
          <ul className="space-y-1 text-xs">
            {orphans.map(c => (
              <li key={c.id} className="flex items-center gap-2 rounded border bg-background/40 px-2 py-1">
                <code className="font-mono">{c.broker}</code>
                <code className="font-mono text-[10px]">{c.user_id.slice(0,8)}</code>
                <span className="text-muted-foreground">{c.label ?? '(no label)'}</span>
                <span className="ml-auto text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Kpi({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums leading-none ${cls}`}>{value}</div>
    </div>
  )
}
