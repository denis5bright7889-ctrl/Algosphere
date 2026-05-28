/**
 * /api/intelligence/stress — institutional market-environment read.
 *
 * Returns the StressView (see lib/stress-engine.ts) — a single universe-
 * level state (Market Stress Elevated / Defensive Environment / Stable
 * Conditions / Aggressive Conditions) plus the component breakdown.
 *
 * No symbol parameter — Stress is a market-environment read, not a
 * per-asset metric.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeStressView } from '@/lib/stress-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const view = await composeStressView()
    return NextResponse.json(view)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Stress compose failed' },
      { status: 502 },
    )
  }
}
