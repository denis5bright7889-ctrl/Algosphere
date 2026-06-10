/**
 * /api/admin/trade-forensics-write
 *
 *   POST                    — process shadow rows missing a forensics row
 *   POST { rebuild: true }  — rebuild ALL forensics rows under the
 *                              current engine_version
 *   GET                     — return per-table row counts + latest rows
 *
 * Admin-only.
 */
import { NextResponse, NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { writeTradeForensics } from '@/lib/intelligence/trade-forensics-writer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { rebuild?: boolean; limit?: number }

  try {
    const report = await writeTradeForensics({
      rebuildAll: body.rebuild === true,
      limit:      typeof body.limit === 'number' ? body.limit : undefined,
    })
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
  const [te, tr, to, tq] = await Promise.all([
    db.from('trade_explanations')
      .select('shadow_execution_id, entry_risk_score, exec_efficiency, outcome_grade, generated_at')
      .order('generated_at', { ascending: false }).limit(20),
    db.from('trade_reviews')
      .select('shadow_execution_id, confidence_score, institutional_rating, reviewed_at')
      .order('reviewed_at', { ascending: false }).limit(20),
    db.from('trade_outcomes')
      .select('shadow_execution_id, actual_pnl, pnl_drift_pct, duration_seconds, was_winner, computed_at')
      .order('computed_at', { ascending: false }).limit(20),
    db.from('trade_quality_scores')
      .select('shadow_execution_id, composite_score, grade, scored_at')
      .order('scored_at', { ascending: false }).limit(20),
  ])

  return NextResponse.json({
    ok: true,
    counts: {
      trade_explanations:   te.data?.length ?? 0,
      trade_reviews:        tr.data?.length ?? 0,
      trade_outcomes:       to.data?.length ?? 0,
      trade_quality_scores: tq.data?.length ?? 0,
    },
    latest: {
      trade_explanations:   te.data ?? [],
      trade_reviews:        tr.data ?? [],
      trade_outcomes:       to.data ?? [],
      trade_quality_scores: tq.data ?? [],
    },
    hint: 'POST to run forensics on pending shadow rows. POST {"rebuild":true} to refresh all rows.',
  })
}
