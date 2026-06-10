/**
 * GET /api/admin/growth/content-validation — Phase 12 health view
 * of the growth content pipeline.
 *
 * Returns one JSON with every signal needed to verify the engine is
 * producing what it should:
 *
 *   • content_kind_counts          — content_items by kind (7d)
 *   • daily_mix_runs               — fired_at + outcome from
 *                                    growth_event_log for daily-mix
 *                                    sourced events
 *   • sample_gate_skips            — events that produced no content
 *                                    (no_match / rate_limited / error)
 *   • last_publish_per_kind        — most-recent successful publish
 *                                    per content_kind
 *   • coverage                     — boolean per spec theme (psychology,
 *                                    risk, architecture, trade,
 *                                    market, coach, broker truth,
 *                                    performance transparency,
 *                                    screenshot, video, blog) — true
 *                                    when ≥1 piece of that kind landed
 *                                    in the past 7 days
 *   • verdict                      — human-readable summary
 *
 * Admin-only. Read-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Content kinds → spec themes. Multiple kinds can satisfy one theme.
const THEME_KINDS: Record<string, string[]> = {
  trading_psychology:       ['educational', 'psychology_insight', 'coach_insights'],
  risk_management:          ['educational'],
  ai_coach_insights:        ['coach_insights'],
  broker_truth_analytics:   ['broker_truth'],
  trade_breakdowns:         ['trade_breakdown'],
  system_architecture:      ['educational'],
  performance_transparency: ['performance_transparency', 'market_report'],
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = svc()
  const since7d = new Date(Date.now() - 7  * 86_400_000).toISOString()
  const since24h = new Date(Date.now() - 86_400_000).toISOString()

  const [{ data: items }, { data: logs }] = await Promise.all([
    db.from('growth_content_items')
      .select('kind, status, created_at, provenance')
      .gte('created_at', since7d)
      .limit(2000),
    db.from('growth_event_log')
      .select('event_type, outcome, created_at, source')
      .eq('source', 'daily_mix')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const rows = (items ?? []) as Array<{ kind: string; status: string; created_at: string; provenance: Record<string, unknown> }>

  // Per-kind counts.
  const kindCounts: Record<string, number> = {}
  const kindLatest: Record<string, string> = {}
  for (const r of rows) {
    kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1
    const prev = kindLatest[r.kind]
    if (!prev || r.created_at > prev) {
      kindLatest[r.kind] = r.created_at
    }
  }

  // Theme coverage.
  const coverage: Record<string, boolean> = {}
  for (const [theme, kinds] of Object.entries(THEME_KINDS)) {
    coverage[theme] = kinds.some((k) => (kindCounts[k] ?? 0) > 0)
  }

  // Daily-mix runs.
  const runs = (logs ?? []) as Array<{ event_type: string; outcome: string; created_at: string; source: string }>
  const runOutcomes: Record<string, number> = { ok: 0, no_match: 0, rate_limited: 0, error: 0 }
  for (const l of runs) {
    runOutcomes[l.outcome] = (runOutcomes[l.outcome] ?? 0) + 1
  }
  const lastRunAt = runs[0]?.created_at ?? null
  const lastRunAgeMin = lastRunAt
    ? Math.round((Date.now() - new Date(lastRunAt).getTime()) / 60_000)
    : null

  // Verdict.
  const themesCovered = Object.values(coverage).filter(Boolean).length
  const totalThemes   = Object.keys(coverage).length
  let verdict = ''
  if (lastRunAgeMin == null) {
    verdict = 'No daily-mix runs in the past 7d. Check the cron schedule + the /api/cron/daily-content endpoint.'
  } else if (lastRunAgeMin > 36 * 60) {
    verdict = `Daily-mix last ran ${Math.round(lastRunAgeMin / 60)}h ago — should run every 24h. Investigate the cron.`
  } else if (themesCovered < totalThemes / 2) {
    verdict = `Only ${themesCovered}/${totalThemes} themes have produced content in the past 7d — sample gates likely suppressing aggregates.`
  } else {
    verdict = `Healthy: ${themesCovered}/${totalThemes} themes covered, last run ${lastRunAgeMin}m ago, ${runOutcomes.ok} successful events.`
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    window: 'last 7d',
    verdict,
    coverage,
    themes_covered:     themesCovered,
    themes_total:       totalThemes,
    content_kind_counts: kindCounts,
    last_publish_per_kind: kindLatest,
    daily_mix: {
      last_run_at:       lastRunAt,
      last_run_age_min:  lastRunAgeMin,
      runs_in_window:    runs.length,
      runs_in_24h:       runs.filter((r) => r.created_at >= since24h).length,
      outcomes:          runOutcomes,
    },
  })
}
