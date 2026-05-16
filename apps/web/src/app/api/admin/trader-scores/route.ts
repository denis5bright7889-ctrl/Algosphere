import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { recomputeAllScores, recomputeTraderScore } from '@/lib/trader-scoring'

// ─── POST /api/admin/trader-scores ──────────────────────────
// Recompute all trader scores (or a single user via ?user_id=).
// Admin-only. Intended to be called by a cron / Celery Beat job.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Allow admin OR internal cron with engine key
  const engineKey = req.headers.get('x-engine-key')
  const isCron    = engineKey && engineKey === process.env.ENGINE_API_KEY
  const isAdminUser = user && isAdmin(user.email)

  if (!isCron && !isAdminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const targetUser = searchParams.get('user_id')
  const svc = createServiceClient()

  if (targetUser) {
    const result = await recomputeTraderScore(svc, targetUser)
    return NextResponse.json(result)
  }

  const result = await recomputeAllScores(svc)
  return NextResponse.json(result)
}
