/**
 * GET /api/admin/broker-ownership — admin review surface for the broker
 * anti-sharing system.
 *
 * Returns:
 *   • Every broker_account_ownership row + its risk score (computed at
 *     read time from broker_ownership_history and persisted back).
 *   • For each fingerprint, the broker_connections rows pointing at it
 *     AND the user_ids that have attempted to claim it (= contention).
 *   • Loose broker_connections rows with no fingerprint yet
 *     (pre-migration data the backfill couldn't claim).
 *
 * Admin-only via isAdmin(email). All reads go through the service-role
 * client (the ownership table's RLS lets users see only their own row;
 * admins need to see everything).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { scoreOwnership, type HistoryEvent } from '@/lib/broker-risk-score'

async function _admin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return null
  return user
}
function _svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface OwnershipRow {
  fingerprint:           string
  broker:                string
  owner_user_id:         string
  ownership_status:      string
  unlink_cooldown_until: string | null
  linked_at:             string
  last_seen_at:          string | null
  last_seen_ip:          string | null
  risk_score:            number
}
interface ConnRow {
  id:                          string
  user_id:                     string
  broker_account_fingerprint:  string | null
  broker:                      string
  status:                      string
  label:                       string | null
}
interface HistRow extends HistoryEvent {
  fingerprint:            string
  previous_owner_user_id: string | null
  new_owner_user_id:      string | null
  reason:                 string | null
}

export async function GET() {
  const admin = await _admin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = _svc()
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
       .gte('created_at', since)
       .limit(5000),
  ])

  const ownerships = (ownRes.data  ?? []) as unknown as OwnershipRow[]
  const conns      = (connRes.data ?? []) as unknown as ConnRow[]
  const history    = (histRes.data ?? []) as unknown as HistRow[]

  // Index by fingerprint.
  const connsByFp: Record<string, ConnRow[]> = {}
  for (const c of conns) if (c.broker_account_fingerprint) {
    (connsByFp[c.broker_account_fingerprint] ??= []).push(c)
  }
  const histByFp: Record<string, HistRow[]> = {}
  for (const h of history) (histByFp[h.fingerprint] ??= []).push(h)

  // Score + persist + reshape for the client.
  const rows = ownerships.map(o => {
    const events = histByFp[o.fingerprint] ?? []
    const risk   = scoreOwnership(events)
    if (risk.score !== o.risk_score) {
      // Best-effort persist — risk write must never block the admin view.
      svc.from('broker_account_ownership')
        .update({ risk_score: risk.score, risk_flags: risk.flags })
        .eq('fingerprint', o.fingerprint)
        .then(() => {}, () => {})
    }
    const fpConns = connsByFp[o.fingerprint] ?? []
    // Contention: distinct user_ids appearing in either active connections
    // pointing at this fingerprint OR reclaim_blocked history that are NOT
    // the current owner.
    const contention = new Set<string>()
    for (const c of fpConns) if (c.user_id !== o.owner_user_id) contention.add(c.user_id)
    for (const h of events) {
      if (h.action === 'reclaim_blocked' && h.new_owner_user_id && h.new_owner_user_id !== o.owner_user_id) {
        contention.add(h.new_owner_user_id)
      }
    }
    return {
      fingerprint:    o.fingerprint,
      broker:         o.broker,
      owner_user_id:  o.owner_user_id,
      status:         o.ownership_status,
      cooldown_until: o.unlink_cooldown_until,
      linked_at:      o.linked_at,
      last_seen_at:   o.last_seen_at,
      last_seen_ip:   o.last_seen_ip,
      risk,
      connections:    fpConns.map(c => ({
        id: c.id, user_id: c.user_id, broker: c.broker, status: c.status, label: c.label,
      })),
      contention:     Array.from(contention),
      history:        events
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20)
        .map(h => ({
          action: h.action, reason: h.reason,
          previous_owner_user_id: h.previous_owner_user_id,
          new_owner_user_id:      h.new_owner_user_id,
          ip_address: h.ip_address, user_agent: h.user_agent,
          created_at: h.created_at,
        })),
    }
  })

  rows.sort((a, b) => b.risk.score - a.risk.score)

  const unfingerprinted = conns
    .filter(c => !c.broker_account_fingerprint)
    .map(c => ({ id: c.id, user_id: c.user_id, broker: c.broker, status: c.status, label: c.label }))

  return NextResponse.json(
    { ownerships: rows, unfingerprinted_connections: unfingerprinted, generated_at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
