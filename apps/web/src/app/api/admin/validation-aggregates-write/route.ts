/**
 * POST /api/admin/validation-aggregates-write
 *
 * Trigger the unified writer that populates four Phase-12 tables in
 * one pass per user (broker_quality_scores, strategy_validation_scores,
 * ai_strategy_reviews, validation_milestones). Admin-only.
 *
 * GET returns a sanity-check summary: last few rows from each of the
 * four target tables so an admin can verify the writer actually
 * persisted something on the last run.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { writeValidationAggregates } from '@/lib/intelligence/validation-aggregates-writer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const report = await writeValidationAggregates()
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = svc()
  const [bq, sv, ar, ms] = await Promise.all([
    db.from('broker_quality_scores')
      .select('user_id, broker, sample_size, execution_quality_score, grade, computed_at')
      .order('computed_at', { ascending: false }).limit(20),
    db.from('strategy_validation_scores')
      .select('user_id, strategy_name, sample_size, readiness_score, qualification_status, computed_at')
      .order('computed_at', { ascending: false }).limit(20),
    db.from('ai_strategy_reviews')
      .select('user_id, strategy_name, overall_grade, readiness_score, recommendation, reviewed_at')
      .order('reviewed_at', { ascending: false }).limit(20),
    db.from('validation_milestones')
      .select('user_id, milestone_kind, achieved_at, metadata')
      .order('achieved_at', { ascending: false }).limit(20),
  ])

  return NextResponse.json({
    ok: true,
    counts: {
      broker_quality_scores:      bq.data?.length      ?? 0,
      strategy_validation_scores: sv.data?.length      ?? 0,
      ai_strategy_reviews:        ar.data?.length      ?? 0,
      validation_milestones:      ms.data?.length      ?? 0,
    },
    latest: {
      broker_quality_scores:      bq.data ?? [],
      strategy_validation_scores: sv.data ?? [],
      ai_strategy_reviews:        ar.data ?? [],
      validation_milestones:      ms.data ?? [],
    },
    hint: 'POST this endpoint to run the writer; rows append to the four Phase-12 history tables.',
  })
}
