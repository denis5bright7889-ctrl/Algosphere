import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

/**
 * GET /api/admin/dlq?status=open|replayed|all&category=<cat>&limit=N
 *
 * Lists copy_jobs_dlq entries platform-wide (admin scope). Default = open.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status   = url.searchParams.get('status')   ?? 'open'   // open | replayed | all
  const category = url.searchParams.get('category')
  const limit    = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 500)

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let q = svc.from('copy_jobs_dlq')
    .select('id, original_job_id, follower_id, leader_id, broker, trace_id, ' +
            'failure_category, attempts, last_error, replayed_at, ' +
            'replay_job_id, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (status === 'open')     q = q.is('replayed_at', null)
  if (status === 'replayed') q = q.not('replayed_at', 'is', null)
  if (category)              q = q.eq('failure_category', category)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-category open totals for the dashboard header.
  const stats = await svc.from('copy_jobs_dlq')
    .select('failure_category, replayed_at').limit(5000)
  const open_by: Record<string, number> = {}
  let total = 0, replayed = 0
  for (const r of (stats.data ?? [])) {
    total++
    if ((r as { replayed_at: string | null }).replayed_at) replayed++
    else {
      const k = (r as { failure_category: string }).failure_category
      open_by[k] = (open_by[k] ?? 0) + 1
    }
  }

  return NextResponse.json({
    entries: data ?? [],
    summary: { total, replayed, open: total - replayed, open_by },
  })
}
