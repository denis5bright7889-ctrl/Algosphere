/**
 * /api/admin/validation-ops-write — Phase 12 (writers 6, 7, 8).
 *
 *   POST  — run the writer; returns OpsWriteResult
 *   GET   — counts + latest rows from the 3 target tables
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { writeValidationOps } from '@/lib/intelligence/validation-ops-writer'

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
    const report = await writeValidationOps()
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
  const [rk, ss, qh] = await Promise.all([
    db.from('strategy_rankings')
      .select('user_id, strategy_name, category, rank, score, computed_at')
      .order('computed_at', { ascending: false }).limit(30),
    db.from('shadow_sessions')
      .select('user_id, strategy_name, broker, started_at, ended_at, trade_count, win_count, total_pnl')
      .order('started_at', { ascending: false }).limit(30),
    db.from('strategy_qualification_history')
      .select('user_id, strategy_name, from_stage, to_stage, transitioned_at')
      .order('transitioned_at', { ascending: false }).limit(30),
  ])

  return NextResponse.json({
    ok: true,
    counts: {
      strategy_rankings:              rk.data?.length ?? 0,
      shadow_sessions:                ss.data?.length ?? 0,
      strategy_qualification_history: qh.data?.length ?? 0,
    },
    latest: {
      strategy_rankings:              rk.data ?? [],
      shadow_sessions:                ss.data ?? [],
      strategy_qualification_history: qh.data ?? [],
    },
    hint: 'POST this endpoint to run the 3 ops writers.',
  })
}
