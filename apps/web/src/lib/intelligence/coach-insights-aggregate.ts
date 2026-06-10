/**
 * Coach-insights aggregator — Phase 3 of the growth content expansion.
 *
 * Reads journal_coach_evaluations across all users, anonymises, and
 * returns the aggregate the generator needs to produce a public
 * "this week's coach themes" post. Pure read; never writes.
 *
 * Honesty contract:
 *   - Minimum sample: 10 evaluations in the window. Below that, returns
 *     null and the orchestrator skips generation. No fabrication.
 *   - All aggregates are means / counts across the full sample. No
 *     individual user is identifiable in the output.
 *   - The window + sample size travel WITH the aggregate so the
 *     generator can stamp them honestly on the published copy.
 */
import 'server-only'
import { createClient as serviceClient } from '@supabase/supabase-js'

const MIN_SAMPLE  = 10
const DEFAULT_WINDOW_DAYS = 7

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface CoachInsightsAggregate {
  window_days:    number
  window_label:   string
  sample_size:    number
  // 0-100 means across the sample.
  avg_quality:    number
  avg_execution:  number
  avg_psychology: number
  avg_risk:       number
  avg_discipline: number
  avg_timing:     number
  // Top 3 "what to fix" themes (counted across the sample).
  top_themes:     Array<{ theme: string; count: number }>
  // Distribution of letter grades derived from quality_score.
  grade_mix:      Array<{ grade: string; count: number; pct: number }>
  generated_at:   string
}

interface EvalRow {
  quality_score:    number | null
  execution_grade:  number | null
  psychology_grade: number | null
  risk_grade:       number | null
  discipline_grade: number | null
  timing_grade:     number | null
  what_to_fix:      string[] | null
  ai_insights:      string[] | null
}

function avg(xs: Array<number | null | undefined>): number {
  const vals = xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return 0
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

function letterFor(s: number): string {
  if (s >= 95) return 'A+'
  if (s >= 90) return 'A'
  if (s >= 85) return 'B+'
  if (s >= 80) return 'B'
  if (s >= 70) return 'C+'
  if (s >= 60) return 'C'
  return 'D'
}

export async function aggregateCoachInsights(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<CoachInsightsAggregate | null> {
  const db = svc()
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const { data, error } = await db
    .from('journal_coach_evaluations')
    .select('quality_score, execution_grade, psychology_grade, risk_grade, discipline_grade, timing_grade, what_to_fix, ai_insights')
    .gte('created_at', since)
    .limit(2000)

  if (error || !data) return null

  const rows = data as EvalRow[]
  if (rows.length < MIN_SAMPLE) return null

  // Aggregate "what to fix" themes — count canonical phrases. The
  // V3 coach emits short standardised strings (e.g. "Tighten stop",
  // "Reduce size in volatile regime"), so a literal-match histogram
  // is honest enough at this volume.
  const themeCounts = new Map<string, number>()
  for (const r of rows) {
    for (const t of [...(r.what_to_fix ?? []), ...(r.ai_insights ?? [])]) {
      const s = (typeof t === 'string' ? t.trim() : '')
      if (s.length < 4 || s.length > 80) continue   // skip garbage / paragraphs
      themeCounts.set(s, (themeCounts.get(s) ?? 0) + 1)
    }
  }
  const topThemes = Array.from(themeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme, count]) => ({ theme, count }))

  // Letter-grade mix.
  const gradeCounts = new Map<string, number>()
  for (const r of rows) {
    const g = letterFor(r.quality_score ?? 0)
    gradeCounts.set(g, (gradeCounts.get(g) ?? 0) + 1)
  }
  const gradeMix = Array.from(gradeCounts.entries())
    .map(([grade, count]) => ({ grade, count, pct: Math.round((count / rows.length) * 100) }))
    .sort((a, b) => b.count - a.count)

  return {
    window_days:    windowDays,
    window_label:   `last ${windowDays}d`,
    sample_size:    rows.length,
    avg_quality:    avg(rows.map((r) => r.quality_score)),
    avg_execution:  avg(rows.map((r) => r.execution_grade)),
    avg_psychology: avg(rows.map((r) => r.psychology_grade)),
    avg_risk:       avg(rows.map((r) => r.risk_grade)),
    avg_discipline: avg(rows.map((r) => r.discipline_grade)),
    avg_timing:     avg(rows.map((r) => r.timing_grade)),
    top_themes:     topThemes,
    grade_mix:      gradeMix,
    generated_at:   new Date().toISOString(),
  }
}
