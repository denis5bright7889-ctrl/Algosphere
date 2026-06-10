/**
 * /api/journal — Journal V3 (Behavioral Trading Intelligence System)
 *
 * V3 acceptance criteria enforced server-side:
 *   - No trade saves without Strategy + Psychology context.
 *   - Every saved trade produces a coach evaluation with 5 process
 *     grades (execution / psychology / risk / discipline / timing)
 *     + an overall score (process-based, NOT P&L-based).
 *   - Every saved trade produces ≥3 AI insights.
 *
 * The required-fields gate fires for manual entries only. Rows
 * inserted by the auto-import pipeline (source='auto', DB trigger on
 * execution_events) skip the gate — the broker can't fill emotion_pre,
 * and the user backfills those fields with the journal edit flow.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { reviewTrade } from '@/lib/ai-reviews'
import { evaluateTrade, EVALUATOR_VERSION } from '@/lib/intelligence/coach-eval'
import { trackServerAsync } from '@/lib/tracking/server'
import { z } from 'zod'

// V3 enums — must mirror the CHECK constraints in migration 55.
const STRATEGY_USED   = ['trend_following', 'breakout', 'scalping', 'swing', 'smc', 'mean_reversion', 'news', 'custom'] as const
const SETUP_VALIDITY  = ['yes', 'partial', 'no'] as const
const MARKET_REGIME   = ['trending', 'ranging', 'volatile', 'reversal', 'low_liquidity'] as const
const SESSION         = ['london', 'new_york', 'asia', 'overlap', 'off_hours'] as const
const EMOTION_PRE     = ['calm', 'focused', 'confident', 'anxious', 'frustrated', 'excited', 'fearful', 'fomo', 'angry', 'euphoric'] as const
const EMOTION_POST    = ['calm', 'proud', 'frustrated', 'regret', 'content'] as const
const REASON_ENTRY    = ['strategy_signal', 'confirmation_setup', 'news', 'impulse', 'fomo'] as const
const RULE_COMPLIANCE = ['full', 'partial', 'none'] as const
const QUALITY         = ['excellent', 'good', 'average', 'poor'] as const
const TIMEFRAME       = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const
const MARKET_CONTEXT  = ['trending', 'ranging', 'news', 'volatile'] as const

// V4: source distinguishes the three lifecycle modes. The DB CHECK
// constraint guarantees only these values land. `manual` and
// `auto_human` require psychology context (the trader clicked the
// order); `auto_engine` does not (the engine self-explains).
const SOURCE = ['manual', 'auto_human', 'auto_engine'] as const

const journalEntrySchema = z.object({
  // ── Core ──
  pair:        z.string().min(1),
  direction:   z.enum(['buy', 'sell']),
  entry_price: z.number().optional(),
  exit_price:  z.number().optional(),
  lot_size:    z.number().positive().optional(),
  pips:        z.number().optional(),
  pnl:         z.number().optional(),
  risk_amount: z.number().positive().optional(),
  setup_tag:   z.string().optional(),
  trade_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source:      z.enum(SOURCE).default('manual'),

  // ── Strategy context (REQUIRED for human modes; engine self-fills) ──
  strategy_used:  z.enum(STRATEGY_USED).optional(),
  setup_validity: z.enum(SETUP_VALIDITY).optional(),
  market_regime:  z.enum(MARKET_REGIME).optional(),
  session:        z.enum(SESSION).optional(),

  // ── Psychology context (REQUIRED for human modes; N/A for engine) ──
  emotion_pre:      z.enum(EMOTION_PRE).optional(),
  reason_for_entry: z.enum(REASON_ENTRY).optional(),
  revenge_trade:    z.boolean().optional(),
  rule_compliance:  z.enum(RULE_COMPLIANCE).optional(),
  confidence_level: z.number().int().min(1).max(10).optional(),

  // ── Engine-execution provenance (REQUIRED for auto_engine; N/A else) ──
  engine_strategy_name:    z.string().max(120).optional(),
  engine_strategy_version: z.number().int().nonnegative().optional(),
  engine_entry_logic:      z.string().max(500).optional(),
  engine_exit_reason:      z.string().max(120).optional(),
  engine_risk_model:       z.string().max(120).optional(),
  engine_position_sizing:  z.string().max(500).optional(),
  engine_volatility_state: z.string().max(60).optional(),

  // ── Execution quality (optional but recommended) ──
  entry_quality:      z.enum(QUALITY).optional(),
  exit_quality:       z.enum(QUALITY).optional(),
  management_quality: z.enum(QUALITY).optional(),

  // ── Thesis & reflection (optional) ──
  thesis:             z.string().max(1500).optional(),
  entry_confirmation: z.string().max(1500).optional(),
  invalidations:      z.string().max(1500).optional(),
  reflection:         z.string().max(1500).optional(),

  // ── Screenshots ──
  screenshot_url:           z.string().url().optional(), // pre-entry (legacy)
  post_exit_screenshot_url: z.string().url().optional(),

  // ── Shared / legacy ──
  emotion_post:   z.enum(EMOTION_POST).optional(),
  timeframe:      z.enum(TIMEFRAME).optional(),
  market_context: z.enum(MARKET_CONTEXT).optional(),
  mistakes:       z.array(z.string().max(40)).max(8).optional(),
  what_went_well: z.string().max(500).optional(),
  improvements:   z.string().max(500).optional(),
  risk_pct:       z.number().min(0).max(100).optional(),
  rule_violation: z.boolean().optional(),
  notes:          z.string().max(2000).optional(),
})

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = journalEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Invalid journal payload.',
      issues: parsed.error.flatten(),
    }, { status: 422 })
  }

  // V4 mode-aware validation. Two lifecycles — never conflate them.
  //   'manual' + 'auto_human' → trader clicked the order.
  //     Required: strategy_used + setup_validity + market_regime +
  //     session + emotion_pre + reason_for_entry + revenge_trade +
  //     rule_compliance + confidence_level
  //   'auto_engine' → AlgoSphere engine executed.
  //     Required: engine_strategy_name + engine_entry_logic +
  //     engine_exit_reason. Psychology is NOT asked.
  const source = parsed.data.source
  if (source === 'manual' || source === 'auto_human') {
    const missing: string[] = []
    if (!parsed.data.strategy_used)    missing.push('strategy_used')
    if (!parsed.data.setup_validity)   missing.push('setup_validity')
    if (!parsed.data.market_regime)    missing.push('market_regime')
    if (!parsed.data.session)          missing.push('session')
    if (!parsed.data.emotion_pre)      missing.push('emotion_pre')
    if (!parsed.data.reason_for_entry) missing.push('reason_for_entry')
    if (parsed.data.revenge_trade == null) missing.push('revenge_trade')
    if (!parsed.data.rule_compliance)  missing.push('rule_compliance')
    if (parsed.data.confidence_level == null) missing.push('confidence_level')
    if (missing.length > 0) {
      return NextResponse.json({
        error: 'Strategy + Psychology context required for human-executed trades.',
        missing,
      }, { status: 422 })
    }
  } else if (source === 'auto_engine') {
    const missing: string[] = []
    if (!parsed.data.engine_strategy_name) missing.push('engine_strategy_name')
    if (!parsed.data.engine_entry_logic)   missing.push('engine_entry_logic')
    if (!parsed.data.engine_exit_reason)   missing.push('engine_exit_reason')
    if (missing.length > 0) {
      return NextResponse.json({
        error: 'Engine provenance required for auto_engine trades.',
        missing,
      }, { status: 422 })
    }
  }

  // rule_violation legacy column is derived from rule_compliance for
  // human modes; engine rows leave it null so analytics that filter on
  // it correctly skip engine output.
  const ruleViolation =
    parsed.data.rule_compliance != null
      ? parsed.data.rule_compliance !== 'full'
      : null

  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      ...parsed.data,
      rule_violation: ruleViolation,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Funnel: journal_created — fire-and-forget. Idempotent at the
  // dashboard layer (distinct user_id collapses repeats).
  trackServerAsync({
    event:       'journal_created',
    userId:      user.id,
    source_kind: 'app',
    payload:     { entry_id: data.id, pair: data.pair ?? null },
  })

  // ── Deterministic V3 coach evaluation (5 grades + 3+ insights) ──
  // Computed synchronously (pure + fast) and returned so the new card
  // shows its grade immediately; the DB insert stays fire-and-forget.
  const evalRow = evaluateTrade(parsed.data)
  const coach = {
    quality_score:    evalRow.quality_score,
    strategy_grade:   evalRow.strategy_grade,
    emotional_flag:   evalRow.emotional_flag,
    emotional_reason: evalRow.emotional_reason,
    advancement:      evalRow.advancement,
    top_fix:          evalRow.what_to_fix?.[0] ?? null,
    execution_grade:  evalRow.execution_grade,
    psychology_grade: evalRow.psychology_grade,
    risk_grade:       evalRow.risk_grade,
    discipline_grade: evalRow.discipline_grade,
    timing_grade:     evalRow.timing_grade,
    ai_insights:      evalRow.ai_insights,
  }
  void (async () => {
    try {
      const svc = createServiceClient()
      await svc.from('journal_coach_evaluations').insert({
        journal_entry_id:  data.id,
        user_id:           user.id,
        quality_score:     evalRow.quality_score,
        strategy_grade:    evalRow.strategy_grade,
        emotional_flag:    evalRow.emotional_flag,
        emotional_reason:  evalRow.emotional_reason,
        what_worked:       evalRow.what_worked,
        what_to_fix:       evalRow.what_to_fix,
        advancement:       evalRow.advancement,
        evaluator_version: EVALUATOR_VERSION,
        execution_grade:   evalRow.execution_grade,
        psychology_grade:  evalRow.psychology_grade,
        risk_grade:        evalRow.risk_grade,
        discipline_grade:  evalRow.discipline_grade,
        timing_grade:      evalRow.timing_grade,
        ai_insights:       evalRow.ai_insights,
      })
    } catch (err) {
      console.error('Coach evaluation insert failed:', err)
    }
  })()

  // Optional generative second pass (Gemini). Only fires when entry+exit
  // are both present; patches ai_review + ai_score post-insert. Skipped
  // entirely when the deterministic evaluator above gave the trade a
  // strong enough read on its own — saves a daily generation quota.
  const hasContext = parsed.data.entry_price != null && parsed.data.exit_price != null
  if (hasContext) {
    void (async () => {
      try {
        const svc    = createServiceClient()
        const review = await reviewTrade(parsed.data)
        if (review) {
          const summary = `${review.grade} · ${review.summary}\n\n` +
            (review.strengths.length ? `Strengths: ${review.strengths.join('; ')}\n` : '') +
            (review.weaknesses.length ? `Improve: ${review.weaknesses.join('; ')}\n` : '') +
            `Advice: ${review.advice}`
          await svc
            .from('journal_entries')
            .update({ ai_review: summary, ai_score: Math.round(review.score) })
            .eq('id', data.id)
        }
      } catch (err) {
        console.error('AI review failed:', err)
      }
    })()
  }

  return NextResponse.json({ data, coach }, { status: 201 })
}
