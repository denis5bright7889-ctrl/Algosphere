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
interface ContentionRow {
  fingerprint:       string
  contender_user_id: string
  status:            'active_contention' | 'resolved_contention' | 'dismissed_contention'
  attempt_count:     number
  first_seen_at:     string
  last_attempt_at:   string
  last_ip:           string | null
  resolved_at:       string | null
  resolved_by:       string | null
  resolution_note:   string | null
}

export async function GET() {
  const admin = await _admin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = _svc()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [ownRes, connRes, histRes, contRes] = await Promise.all([
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
    svc.from('broker_contention')
       .select('fingerprint, contender_user_id, status, attempt_count, first_seen_at, last_attempt_at, last_ip, resolved_at, resolved_by, resolution_note')
       .limit(5000),
  ])

  const ownerships = (ownRes.data  ?? []) as unknown as OwnershipRow[]
  const conns      = (connRes.data ?? []) as unknown as ConnRow[]
  const history    = (histRes.data ?? []) as unknown as HistRow[]
  const contention = (contRes.data ?? []) as unknown as ContentionRow[]

  // Index by fingerprint.
  const connsByFp: Record<string, ConnRow[]> = {}
  for (const c of conns) if (c.broker_account_fingerprint) {
    (connsByFp[c.broker_account_fingerprint] ??= []).push(c)
  }
  const histByFp: Record<string, HistRow[]> = {}
  for (const h of history) (histByFp[h.fingerprint] ??= []).push(h)
  const contByFp: Record<string, ContentionRow[]> = {}
  for (const c of contention) (contByFp[c.fingerprint] ??= []).push(c)

  // Score + persist + reshape for the client.
  const rows = ownerships.map(o => {
    const allEvents = histByFp[o.fingerprint] ?? []
    const cont      = contByFp[o.fingerprint] ?? []

    // Per-contender resolution state. Contenders that an admin has
    // resolved/dismissed are excluded from the RISK score's reclaim_blocked
    // input — resolving genuinely removes the risk noise (per the brief).
    const resolvedUsers = new Set(
      cont.filter(c => c.status !== 'active_contention').map(c => c.contender_user_id),
    )
    const events = allEvents.filter(h =>
      !(h.action === 'reclaim_blocked' && h.new_owner_user_id && resolvedUsers.has(h.new_owner_user_id)),
    )
    const risk = scoreOwnership(events)
    if (risk.score !== o.risk_score) {
      // Best-effort persist — risk write must never block the admin view.
      svc.from('broker_account_ownership')
        .update({ risk_score: risk.score, risk_flags: risk.flags })
        .eq('fingerprint', o.fingerprint)
        .then(() => {}, () => {})
    }
    const fpConns = connsByFp[o.fingerprint] ?? []

    // Contention split from the broker_contention state table. Active drives
    // banners + counters; resolved/dismissed stay for audit but are hidden
    // from active operational UI.
    const shape = (c: ContentionRow) => ({
      user_id: c.contender_user_id, status: c.status, attempt_count: c.attempt_count,
      first_seen_at: c.first_seen_at, last_attempt_at: c.last_attempt_at,
      last_ip: c.last_ip, resolved_at: c.resolved_at, resolution_note: c.resolution_note,
    })
    const activeContention  = cont.filter(c => c.status === 'active_contention').map(shape)
    const resolvedAttempts  = cont.filter(c => c.status !== 'active_contention').map(shape)

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
      // Active contention only (the operational signal). Resolved kept separate.
      contention:        activeContention.map(c => c.user_id),
      active_contention: activeContention,
      resolved_attempts: resolvedAttempts,
      history:        allEvents
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
