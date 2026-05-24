import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

/**
 * GET /api/admin/workers
 *
 * Worker liveness proxy derived from DB activity (no Prometheus dep): for
 * each distinct copy_jobs.claimed_by in the last hour, report claim count
 * and most-recent claim time. A worker that hasn't claimed in >2× the
 * lease is presumed stale. The canonical worker-health view is still
 * Prometheus + Grafana (ops/observability) — this is the in-browser
 * fallback for incident response.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: rows, error } = await svc.from('copy_jobs')
    .select('claimed_by, claimed_at')
    .gte('claimed_at', oneHourAgo)
    .not('claimed_by', 'is', null)
    .order('claimed_at', { ascending: false })
    .limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Stat = { claims: number; last: string }
  const byWorker = new Map<string, Stat>()
  for (const r of rows ?? []) {
    const w = (r as { claimed_by: string }).claimed_by
    const ts = (r as { claimed_at: string }).claimed_at
    const cur = byWorker.get(w)
    if (!cur || ts > cur.last) byWorker.set(w, { claims: (cur?.claims ?? 0) + 1, last: ts })
    else                       cur.claims += 1
  }

  // Also surface queue posture so the UI can correlate stalled queue with dead worker.
  const [queued, claimed, failed] = await Promise.all([
    svc.from('copy_jobs').select('id', { head: true, count: 'exact' }).eq('status', 'queued'),
    svc.from('copy_jobs').select('id', { head: true, count: 'exact' })
      .in('status', ['claimed','risk_check','allocating','routing','submitted']),
    svc.from('copy_jobs').select('id', { head: true, count: 'exact' }).eq('status', 'failed'),
  ])

  const STALE_S = 240   // 2× default 120s lease
  const now = Date.now()
  const workers = Array.from(byWorker.entries())
    .map(([id, s]) => {
      const ageS = Math.round((now - new Date(s.last).getTime()) / 1000)
      return { worker_id: id, claims_1h: s.claims, last_claim: s.last, age_s: ageS,
               status: ageS <= STALE_S ? 'active' : 'stale' }
    })
    .sort((a, b) => a.age_s - b.age_s)

  return NextResponse.json({
    workers,
    queue: { queued: queued.count ?? 0, in_flight: claimed.count ?? 0, failed: failed.count ?? 0 },
    canonical_observability: 'ops/observability (Prometheus + Grafana)',
  })
}
