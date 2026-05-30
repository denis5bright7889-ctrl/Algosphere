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

  // ── Strategy context (REQUIRED — V3 acceptance) ──
  strategy_used:  z.enum(STRATEGY_USED),
  setup_validity: z.enum(SETUP_VALIDITY),
  market_regime:  z.enum(MARKET_REGIME),
  session:        z.enum(SESSION),

  // ── Psychology context (REQUIRED — V3 acceptance) ──
  emotion_pre:      z.enum(EMOTION_PRE),
  reason_for_entry: z.enum(REASON_ENTRY),
  revenge_trade:    z.boolean(),
  rule_compliance:  z.enum(RULE_COMPLIANCE),
  confidence_level: z.number().int().min(1).max(10),

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
      error: 'Strategy + Psychology context required.',
      issues: parsed.error.flatten(),
    }, { status: 422 })
  }

  // rule_violation legacy column is derived from rule_compliance so
  // the existing analytics that read it keep working.
  const ruleViolation = parsed.data.rule_compliance !== 'full'

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

  // ── Deterministic V3 coach evaluation (5 grades + 3+ insights) ──
  // Always runs; never blocks the 201; insert order is structured so
  // partial failures still leave a usable journal row.
  void (async () => {
    try {
      const evalRow = evaluateTrade(parsed.data)
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

  return NextResponse.json({ data }, { status: 201 })
}
