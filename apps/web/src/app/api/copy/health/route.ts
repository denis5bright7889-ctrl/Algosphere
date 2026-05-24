import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/copy/health
 *
 * Follower's copy-health scorecards (one per active subscription),
 * RLS-confined. Computed by the reconciler every ~2 min from copy_jobs
 * via recompute_copy_health() — fill rate, p95 signal→fill lag, open
 * desync count, failure rate → 0-100 health_score + label
 * (excellent/good/degraded/poor/idle).
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('copy_health')
    .select(
      'subscription_id, leader_id, window_hours, total_jobs, filled, ' +
      'failed, rejected, fill_rate, avg_lag_ms, p95_lag_ms, desync_open, ' +
      'failed_rate, health_score, health_label, updated_at',
    )
    .eq('follower_id', user.id)
    .order('health_score', { ascending: false, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scorecards: data ?? [] })
}
