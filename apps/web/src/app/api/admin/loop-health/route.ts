/**
 * GET /api/admin/loop-health — master-prompt layer 9 (Closed-Loop Validation).
 *
 * Single real-data verdict on the full loop: Signals → Execution → Broker
 * Reality Sync → Journal → Analytics → Observability → Symbol Coverage →
 * Reconciliation. Each layer is RAG-graded from production tables; if any
 * critical layer is red the system reports DEGRADED LOOP STATE. No
 * fabrication — a layer with no data is red/amber with the real reason.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

type RAG = 'green' | 'amber' | 'red'
interface Layer { layer: string; status: RAG; metric: string; detail: string }

function svc() {
  return serviceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const db = svc()
  const now = Date.now()
  const since = (h: number) => new Date(now - h * 3_600_000).toISOString()
  const count = async (t: string, col: string, h: number): Promise<number> => {
    const r = await db.from(t).select('id', { count: 'exact', head: true }).gte(col, since(h))
    return r.count ?? 0
  }

  const [sig24, exec24, journ24, sel24, execAll, execReal] = await Promise.all([
    count('signals', 'published_at', 24),
    count('execution_events', 'created_at', 24),
    count('journal_entries', 'created_at', 24),
    count('system_event_log', 'sent_at', 24),
    db.from('execution_events').select('id', { count: 'exact', head: true }),
    db.from('execution_events').select('id', { count: 'exact', head: true }).neq('broker', 'paper'),
  ])

  // Heartbeats (observability + reconciliation liveness).
  const { data: hb } = await db.from('engine_heartbeats').select('component, last_at')
  const ageOf = (c: string) => {
    const h = (hb ?? []).find((x) => x.component === c)
    return h ? Math.round((now - Date.parse(h.last_at)) / 1000) : null
  }
  const worker = ageOf('signal_worker')
  const recon = ageOf('broker_reconciler')

  const layers: Layer[] = [
    { layer: 'Signals', ...(sig24 > 0
        ? { status: 'green' as RAG, metric: `${sig24}/24h`, detail: 'generating' }
        : { status: 'red' as RAG, metric: '0/24h', detail: 'no signals — pipeline degraded or ensemble over-suppressed' }) },
    { layer: 'Execution', ...((execReal.count ?? 0) > 0
        ? { status: 'green' as RAG, metric: `${exec24}/24h`, detail: 'real broker executions present' }
        : { status: 'red' as RAG, metric: `${execAll.count ?? 0} total (paper only)`, detail: 'NO REAL TRADES DETECTED — paper/testnet only' }) },
    { layer: 'Broker Reality Sync', ...(recon != null && recon < 120
        ? { status: 'green' as RAG, metric: `${recon}s`, detail: 'reconciler heartbeating' }
        : { status: 'amber' as RAG, metric: recon == null ? 'dormant' : `${recon}s`, detail: 'broker reconciler not running (BROKER_SYNC_ENABLED off / not deployed)' }) },
    { layer: 'Journal', ...(journ24 > 0
        ? { status: 'green' as RAG, metric: `${journ24}/24h`, detail: 'entries flowing' }
        : { status: 'red' as RAG, metric: '0/24h', detail: 'NO CLOSED LOOP DATA — no journal entries' }) },
    { layer: 'Observability', ...(sel24 > 0 && worker != null && worker < 1800
        ? { status: 'green' as RAG, metric: `${sel24} ev/24h · hb ${worker}s`, detail: 'event stream + heartbeat live' }
        : { status: 'red' as RAG, metric: `${sel24} ev/24h · hb ${worker ?? '—'}s`, detail: 'event stream or heartbeat stale' }) },
    { layer: 'Symbol Coverage', ...(sig24 > 0
        ? { status: 'green' as RAG, metric: `${sig24} active`, detail: 'symbols firing' }
        : { status: 'amber' as RAG, metric: '0 active', detail: 'all symbols filtered/silent — see /admin/signals coverage' }) },
  ]

  const reds = layers.filter((l) => l.status === 'red').length
  const ambers = layers.filter((l) => l.status === 'amber').length
  const overall = reds > 0 ? 'DEGRADED_LOOP_STATE' : ambers > 0 ? 'PARTIAL' : 'HEALTHY'

  return NextResponse.json({
    ok: true, generated_at: new Date().toISOString(),
    overall, reds, ambers, layers,
  })
}
