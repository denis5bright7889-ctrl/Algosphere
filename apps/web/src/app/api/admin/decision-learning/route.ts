/**
 * GET /api/admin/decision-learning — Decision Brain learning status.
 *
 * Admin-only, READ-ONLY. Reports the substrate state honestly: how many
 * decision-brain decisions have been logged, how many labelled outcomes
 * exist, the baseline weight vector, and whether learned-weight activation
 * is governed/inactive. It does NOT mutate weights — per
 * docs/architecture/adaptive-intelligence.md, learned-weight application
 * is human-gated and requires accumulated, labelled volume.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { W0, summarizeReadiness } from '@/lib/decision-brain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Service role not configured' }, { status: 500 })
  }
  const svc = serviceClient(url, key)

  // Decision-brain decisions logged so far (substrate volume).
  const { count: decisionsLogged } = await svc
    .from('intel_decisions')
    .select('*', { count: 'exact', head: true })
    .eq('surface', 'decision-brain')

  // Outcomes: the intel_outcomes table is part of the deferred migration;
  // until applied, labelled-outcome count is 0 and learning stays inactive.
  let outcomesLabelled = 0
  try {
    const { count } = await svc
      .from('intel_outcomes')
      .select('*', { count: 'exact', head: true })
    outcomesLabelled = count ?? 0
  } catch { /* table not migrated yet — honest 0 */ }

  const readiness = summarizeReadiness(decisionsLogged ?? 0, outcomesLabelled)

  return NextResponse.json({
    layer: 'L3 adaptive weighting',
    baseline_weights: W0,
    weighting_mode: 'W0 + deterministic regime-aware tilt (live)',
    learned_weights: 'governed — not auto-applied (see adaptive-intelligence.md)',
    readiness,
    notes: [
      'Live decisions use W0 tilted deterministically by regime — no training data required, no drift risk.',
      'Decision logging is active; the learning loop labels + attributes outcomes only once the outcomes table is migrated and enough labelled volume exists.',
      'Learned weights are PROPOSED under governance and never silently auto-applied.',
    ],
    generated_at: new Date().toISOString(),
  })
}
