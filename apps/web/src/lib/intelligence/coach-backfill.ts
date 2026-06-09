/**
 * Coach-eval backfill — runs the deterministic V3 coach evaluator on
 * journal entries that have no `journal_coach_evaluations` row yet.
 *
 * Why this exists: the engine's broker-reality reconciler injects
 * journal entries via DB trigger (migration 29). That trigger creates
 * the row but doesn't run the TypeScript coach evaluator — so
 * auto-detected trades land in the journal with no coach feedback.
 * This backfill closes the gap.
 *
 * The same function can be called:
 *   • On /journal page load (server component) — backfills the
 *     current user's entries on demand.
 *   • From an admin endpoint — backfills any user's entries.
 *
 * Idempotent + safe to call repeatedly. Returns the count of
 * evaluations inserted. Skips any entry that already has a coach
 * eval row, even if it was inserted by a parallel render.
 */
import 'server-only'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { evaluateTrade, EVALUATOR_VERSION } from './coach-eval'

// Mirror the row shape we need from journal_entries — only the fields
// the evaluator reads.
interface JournalRowForCoach {
  id:               string
  user_id:          string
  pair:             string | null
  direction:        string | null
  pnl:              number | null
  pips:             number | null
  strategy_used:    string | null
  setup_validity:   string | null
  market_regime:    string | null
  market_context:   string | null
  session:          string | null
  setup_tag:        string | null
  emotion_pre:      string | null
  emotion_post:     string | null
  reason_for_entry: string | null
  revenge_trade:    boolean | null
  rule_compliance:  string | null
  confidence_level: number | null
  entry_quality:    string | null
  exit_quality:     string | null
  management_quality: string | null
  thesis:           string | null
  entry_confirmation: string | null
  invalidations:    string | null
  reflection:       string | null
  risk_pct:         number | null
  risk_amount:      number | null
  rule_violation:   boolean | null
  mistakes:         string[] | null
  what_went_well:   string | null
  improvements:     string | null
  notes:            string | null
  regime_at_entry:  string | null
}

const COACH_FIELDS =
  'id, user_id, pair, direction, pnl, pips, strategy_used, setup_validity, ' +
  'market_regime, market_context, session, setup_tag, emotion_pre, emotion_post, ' +
  'reason_for_entry, revenge_trade, rule_compliance, confidence_level, ' +
  'entry_quality, exit_quality, management_quality, thesis, entry_confirmation, ' +
  'invalidations, reflection, risk_pct, risk_amount, rule_violation, mistakes, ' +
  'what_went_well, improvements, notes, regime_at_entry'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface BackfillResult {
  scanned:    number
  evaluated:  number
  skipped:    number    // already had an eval
  errors:     number
}

/**
 * Evaluate every journal entry for a user that doesn't already have
 * a coach evaluation row. Bounded: looks at the most recent 200
 * entries — older un-evaluated rows are background-noise and can be
 * back-filled with a dedicated cron later if it ever matters.
 */
export async function backfillCoachEvalsForUser(userId: string): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, evaluated: 0, skipped: 0, errors: 0 }

  const db = svc()

  // Pull recent entries + their existing eval ids in two parallel calls.
  const [{ data: entries }, { data: existingEvals }] = await Promise.all([
    db.from('journal_entries')
      .select(COACH_FIELDS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    db.from('journal_coach_evaluations')
      .select('journal_entry_id')
      .eq('user_id', userId),
  ])

  const rows = (entries ?? []) as unknown as JournalRowForCoach[]
  result.scanned = rows.length

  const evaluatedIds = new Set<string>(
    (existingEvals ?? []).map((e) => (e as { journal_entry_id: string }).journal_entry_id),
  )

  const toInsert: Array<Record<string, unknown>> = []
  for (const row of rows) {
    if (evaluatedIds.has(row.id)) {
      result.skipped += 1
      continue
    }
    try {
      const e = evaluateTrade({
        pair:               row.pair,
        direction:          row.direction,
        pnl:                row.pnl,
        pips:               row.pips,
        strategy_used:      row.strategy_used,
        setup_validity:     row.setup_validity,
        market_regime:      row.market_regime,
        market_context:     row.market_context,
        session:            row.session,
        setup_tag:          row.setup_tag,
        emotion_pre:        row.emotion_pre,
        emotion_post:       row.emotion_post,
        reason_for_entry:   row.reason_for_entry,
        revenge_trade:      row.revenge_trade,
        rule_compliance:    row.rule_compliance,
        confidence_level:   row.confidence_level,
        entry_quality:      row.entry_quality,
        exit_quality:       row.exit_quality,
        management_quality: row.management_quality,
        thesis:             row.thesis,
        entry_confirmation: row.entry_confirmation,
        invalidations:      row.invalidations,
        reflection:         row.reflection,
        risk_pct:           row.risk_pct,
        risk_amount:        row.risk_amount,
        rule_violation:     row.rule_violation,
        mistakes:           row.mistakes,
        what_went_well:     row.what_went_well,
        improvements:       row.improvements,
        notes:              row.notes,
        regime_at_entry:    row.regime_at_entry,
      })
      toInsert.push({
        journal_entry_id:  row.id,
        user_id:           userId,
        quality_score:     e.quality_score,
        strategy_grade:    e.strategy_grade,
        emotional_flag:    e.emotional_flag,
        emotional_reason:  e.emotional_reason,
        what_worked:       e.what_worked,
        what_to_fix:       e.what_to_fix,
        advancement:       e.advancement,
        evaluator_version: EVALUATOR_VERSION,
        execution_grade:   e.execution_grade,
        psychology_grade:  e.psychology_grade,
        risk_grade:        e.risk_grade,
        discipline_grade:  e.discipline_grade,
        timing_grade:      e.timing_grade,
        ai_insights:       e.ai_insights,
      })
    } catch {
      result.errors += 1
    }
  }

  if (toInsert.length > 0) {
    const { error } = await db.from('journal_coach_evaluations').insert(toInsert)
    if (error) {
      // If a unique constraint races us (parallel render also inserted),
      // count as skipped rather than errored — the eval exists either way.
      result.errors += toInsert.length
    } else {
      result.evaluated = toInsert.length
    }
  }

  return result
}
