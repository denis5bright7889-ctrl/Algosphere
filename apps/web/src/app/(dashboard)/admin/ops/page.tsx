/**
 * Admin Ops — incident-response cockpit.
 *
 * One page to drive the break-glass tooling without SSHing into a worker:
 *   • Kill switch toggle (immediately halts new exposure platform-wide;
 *     reduce_only flatten still permitted)
 *   • DLQ list + per-row Replay button (RPC is idempotent)
 *   • Worker liveness derived from copy_jobs.claimed_by recency
 *
 * Server component fetches initial state; a small client component drives
 * mutations and refreshes the route via router.refresh().
 *
 * Gated by isAdmin (ADMIN_EMAIL env match) — same check used in the API
 * routes. Non-admin users get 'Forbidden'.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin'
import { createClient as serviceClient } from '@supabase/supabase-js'
import OpsClient from './OpsClient'
import type { Database } from '@/lib/supabase/database.types'

type Kill = Database['public']['Tables']['global_risk_state']['Row']
type Dlq  = Database['public']['Tables']['copy_jobs_dlq']['Row']
type Claim = Pick<Database['public']['Tables']['copy_jobs']['Row'], 'claimed_by' | 'claimed_at'>

export const dynamic = 'force-dynamic'

export default async function AdminOpsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAdmin(user.email)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Admin access required. Set <code>ADMIN_EMAIL</code> in env to your address.
        </p>
      </main>
    )
  }

  // Fetch initial state via service role — same trust model as the API routes.
  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const [killRes, dlqRes, allDlqRes, claimsRes, qRes, fRes] = await Promise.all([
    svc.from('global_risk_state')
      .select('kill_switch, reason, activated_by, activated_at')
      .eq('id', true).maybeSingle(),
    svc.from('copy_jobs_dlq')
      .select('id, original_job_id, follower_id, broker, trace_id, ' +
              'failure_category, attempts, last_error, replayed_at, created_at')
      .is('replayed_at', null)
      .order('created_at', { ascending: false }).limit(50),
    svc.from('copy_jobs_dlq').select('failure_category, replayed_at').limit(5000),
    svc.from('copy_jobs').select('claimed_by, claimed_at')
      .gte('claimed_at', oneHourAgo).not('claimed_by', 'is', null)
      .order('claimed_at', { ascending: false }).limit(5000),
    svc.from('copy_jobs').select('id', { head: true, count: 'exact' }).eq('status', 'queued'),
    svc.from('copy_jobs').select('id', { head: true, count: 'exact' }).eq('status', 'failed'),
  ])

  const kill   = (killRes.data ?? null) as Kill | null
  const dlq    = (dlqRes.data    ?? []) as unknown as Dlq[]
  const all    = (allDlqRes.data ?? []) as unknown as Pick<Dlq, 'failure_category' | 'replayed_at'>[]
  const claims = (claimsRes.data ?? []) as unknown as Claim[]

  // DLQ stats by category
  const openByCat: Record<string, number> = {}
  let replayed = 0
  for (const r of all) {
    if (r.replayed_at) replayed++
    else openByCat[r.failure_category] = (openByCat[r.failure_category] ?? 0) + 1
  }

  // Worker liveness — query filters not-null, but TS doesn't track that.
  const byWorker = new Map<string, { claims: number; last: string }>()
  for (const r of claims) {
    if (!r.claimed_by || !r.claimed_at) continue
    const cur = byWorker.get(r.claimed_by)
    if (!cur || r.claimed_at > cur.last)
      byWorker.set(r.claimed_by, { claims: (cur?.claims ?? 0) + 1, last: r.claimed_at })
    else
      cur.claims += 1
  }
  const STALE_S = 240
  const now = Date.now()
  const workers = Array.from(byWorker.entries())
    .map(([id, s]) => {
      const ageS = Math.round((now - new Date(s.last).getTime()) / 1000)
      return { id, claims: s.claims, last: s.last, ageS, status: ageS <= STALE_S ? 'active' : 'stale' }
    })
    .sort((a, b) => a.ageS - b.ageS)

  return (
    <OpsClient
      initial={{
        kill,
        dlq,
        dlqStats: { total: all.length, open: all.length - replayed, replayed, openByCat },
        workers,
        queue: { queued: qRes.count ?? 0, failed: fRes.count ?? 0 },
        adminEmail: user.email,
      }}
    />
  )
}
