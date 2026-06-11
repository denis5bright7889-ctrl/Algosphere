/**
 * Trust-audit backfill: re-score EVERY journal entry with coach-eval v3 and
 * report before/after vs the existing (v1/v2) evaluations.
 *
 *   cd apps/web && node --experimental-strip-types --env-file=.env.local \
 *     scripts/coach-backfill-v3.ts [--write]
 *
 * Without --write it's a DRY RUN (computes + reports, inserts nothing).
 * With --write it inserts v3 evaluation rows (latest-wins on display).
 */
import { createClient } from '@supabase/supabase-js'
import { evaluateTrade, EVALUATOR_VERSION, type EvaluatorInput } from '../src/lib/intelligence/coach-eval.ts'

const WRITE = process.argv.includes('--write')
const db = createClient(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const num = (v: unknown) => (typeof v === 'number' ? v : v == null ? null : Number(v))

async function main() {
  // 1. All journal entries (the behavioral record the evaluator reads).
  const { data: entries, error } = await db.from('journal_entries').select('*').limit(5000)
  if (error) throw new Error(error.message)
  console.log(`journal entries: ${entries!.length}`)

  // 2. Existing latest eval per entry (the "before").
  const { data: evals } = await db.from('journal_coach_evaluations')
    .select('journal_entry_id, quality_score, strategy_grade, evaluator_version, created_at')
    .order('created_at', { ascending: false })
  const oldByEntry = new Map<string, { quality_score: number | null; strategy_grade: string | null; v: number }>()
  for (const e of evals ?? []) {
    if (!oldByEntry.has(e.journal_entry_id))
      oldByEntry.set(e.journal_entry_id, { quality_score: e.quality_score, strategy_grade: e.strategy_grade, v: e.evaluator_version })
  }

  // 3. Re-score with v3 + collect before/after.
  let inserted = 0
  const conf: Record<string, number> = { high: 0, medium: 0, low: 0, insufficient: 0 }
  let oldSum = 0, oldN = 0, newSum = 0, newN = 0
  let flippedToInsufficient = 0, wasHighNowInsufficient = 0
  const samples: string[] = []
  const toInsert: Record<string, unknown>[] = []

  for (const row of entries!) {
    const input: EvaluatorInput = { ...row, risk_pct: num(row.risk_pct), confidence_level: num(row.confidence_level), pnl: num(row.pnl) }
    const ev = evaluateTrade(input)
    conf[ev.confidence]++
    const old = oldByEntry.get(row.id)
    if (old?.quality_score != null) { oldSum += old.quality_score; oldN++ }
    if (ev.quality_score != null) { newSum += ev.quality_score; newN++ }
    if (ev.quality_score == null && old?.quality_score != null) {
      flippedToInsufficient++
      if (old.quality_score >= 70) wasHighNowInsufficient++
      if (samples.length < 6)
        samples.push(`  ${row.pair ?? '—'} ${row.trade_date ?? ''}: was ${old.quality_score}/${old.strategy_grade} → now INSUFFICIENT (only ${Math.round(ev.data_completeness*5)}/5 logged)`)
    }
    toInsert.push({
      journal_entry_id: row.id, user_id: row.user_id,
      quality_score: ev.quality_score, strategy_grade: ev.strategy_grade,
      confidence: ev.confidence, data_completeness: ev.data_completeness,
      emotional_flag: ev.emotional_flag, emotional_reason: ev.emotional_reason,
      what_worked: ev.what_worked, what_to_fix: ev.what_to_fix, advancement: ev.advancement,
      evaluator_version: EVALUATOR_VERSION,
      execution_grade: ev.execution_grade, psychology_grade: ev.psychology_grade,
      risk_grade: ev.risk_grade, discipline_grade: ev.discipline_grade, timing_grade: ev.timing_grade,
      ai_insights: ev.ai_insights,
    })
  }

  // 4. Write (batched) if --write.
  if (WRITE) {
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200)
      const { error: insErr } = await db.from('journal_coach_evaluations').insert(batch)
      if (insErr) { console.error('insert batch failed:', insErr.message); break }
      inserted += batch.length
    }
  }

  // 5. Report.
  console.log('\n══════════ BEFORE → AFTER (coach-eval v3) ══════════')
  console.log(`mode: ${WRITE ? 'WRITE (' + inserted + ' rows inserted)' : 'DRY RUN'}`)
  console.log(`OLD avg quality_score (graded): ${oldN ? (oldSum/oldN).toFixed(1) : 'n/a'}  (n=${oldN})`)
  console.log(`NEW avg quality_score (graded): ${newN ? (newSum/newN).toFixed(1) : 'n/a'}  (n=${newN})`)
  console.log(`Entries now INSUFFICIENT DATA (were a number before): ${flippedToInsufficient}`)
  console.log(`  …of which were previously scored ≥70 ("good"): ${wasHighNowInsufficient}  ← false confidence removed`)
  console.log(`NEW confidence distribution: ${JSON.stringify(conf)}`)
  if (samples.length) { console.log('\nExamples (false-confidence corrected):'); samples.forEach((s) => console.log(s)) }
}
main().catch((e) => { console.error(e); process.exit(1) })
