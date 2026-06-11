import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { evaluateTrade, EVALUATOR_VERSION } from '@/lib/intelligence/coach-eval'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}


// ─── PATCH — re-edit an existing journal entry ─────────────────────
// Subset of the POST schema, every field optional. RLS guarantees the
// user can only patch their own rows; the .eq('user_id', user.id)
// here is belt-and-braces for the service-role fall-through.
//
// Re-runs the coach evaluator on the merged row after a successful
// patch so the grade reflects the new context (the coach is
// idempotent on the same input; downstream views read the latest
// evaluation by created_at).

const STRATEGY_USED   = ['trend_following', 'breakout', 'scalping', 'swing', 'smc', 'mean_reversion', 'news', 'custom'] as const
const SETUP_VALIDITY  = ['yes', 'partial', 'no'] as const
const MARKET_REGIME   = ['trending', 'ranging', 'volatile', 'reversal', 'low_liquidity'] as const
const SESSION         = ['london', 'new_york', 'asia', 'overlap', 'off_hours'] as const
const EMOTION_PRE     = ['calm', 'focused', 'confident', 'anxious', 'frustrated', 'excited', 'fearful', 'fomo', 'angry', 'euphoric'] as const
const EMOTION_POST    = ['calm', 'proud', 'frustrated', 'regret', 'content'] as const
const REASON_ENTRY    = ['strategy_signal', 'confirmation_setup', 'news', 'impulse', 'fomo'] as const
const RULE_COMPLIANCE = ['full', 'partial', 'none'] as const
const QUALITY         = ['excellent', 'good', 'average', 'poor'] as const

const patchSchema = z.object({
  pair:        z.string().min(1).optional(),
  direction:   z.enum(['buy', 'sell']).optional(),
  entry_price: z.number().optional(),
  exit_price:  z.number().optional(),
  lot_size:    z.number().positive().optional(),
  pips:        z.number().optional(),
  pnl:         z.number().optional(),
  risk_amount: z.number().positive().optional(),
  risk_pct:    z.number().min(0).max(100).optional(),
  setup_tag:   z.string().optional(),
  trade_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  strategy_used:  z.enum(STRATEGY_USED).optional(),
  setup_validity: z.enum(SETUP_VALIDITY).optional(),
  market_regime:  z.enum(MARKET_REGIME).optional(),
  session:        z.enum(SESSION).optional(),

  emotion_pre:      z.enum(EMOTION_PRE).optional(),
  emotion_post:     z.enum(EMOTION_POST).optional(),
  reason_for_entry: z.enum(REASON_ENTRY).optional(),
  revenge_trade:    z.boolean().optional(),
  rule_compliance:  z.enum(RULE_COMPLIANCE).optional(),
  confidence_level: z.number().int().min(1).max(10).optional(),

  entry_quality:      z.enum(QUALITY).optional(),
  exit_quality:       z.enum(QUALITY).optional(),
  management_quality: z.enum(QUALITY).optional(),

  thesis:             z.string().max(1500).optional(),
  entry_confirmation: z.string().max(1500).optional(),
  invalidations:      z.string().max(1500).optional(),
  reflection:         z.string().max(1500).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }

  // Drop undefined keys — they shouldn't overwrite existing values.
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Empty patch' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)   return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Re-run the coach on the merged row. The evaluator is pure +
  // deterministic, so compute it SYNCHRONOUSLY and return the fresh
  // grade in the response — the client updates the card immediately
  // instead of showing the stale pre-edit evaluation (the bug where an
  // edit "saved" but nothing visibly changed). The DB insert stays
  // fire-and-forget (append-only; latest row wins on next load).
  const ev = evaluateTrade(data)
  const coach = {
    quality_score:    ev.quality_score,
    strategy_grade:   ev.strategy_grade,
    confidence:       ev.confidence,
    data_completeness: ev.data_completeness,
    emotional_flag:   ev.emotional_flag,
    emotional_reason: ev.emotional_reason,
    advancement:      ev.advancement,
    top_fix:          ev.what_to_fix?.[0] ?? null,
    execution_grade:  ev.execution_grade,
    psychology_grade: ev.psychology_grade,
    risk_grade:       ev.risk_grade,
    discipline_grade: ev.discipline_grade,
    timing_grade:     ev.timing_grade,
    ai_insights:      ev.ai_insights,
  }

  void (async () => {
    try {
      const svc = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      await svc.from('journal_coach_evaluations').insert({
        journal_entry_id:  data.id,
        user_id:           user.id,
        quality_score:     ev.quality_score,
        strategy_grade:    ev.strategy_grade,
        confidence:        ev.confidence,
        data_completeness: ev.data_completeness,
        emotional_flag:    ev.emotional_flag,
        emotional_reason:  ev.emotional_reason,
        what_worked:       ev.what_worked,
        what_to_fix:       ev.what_to_fix,
        advancement:       ev.advancement,
        evaluator_version: EVALUATOR_VERSION,
        execution_grade:   ev.execution_grade,
        psychology_grade:  ev.psychology_grade,
        risk_grade:        ev.risk_grade,
        discipline_grade:  ev.discipline_grade,
        timing_grade:      ev.timing_grade,
        ai_insights:       ev.ai_insights,
      })
    } catch (err) {
      console.error('Coach re-evaluation on PATCH failed:', err)
    }
  })()

  return NextResponse.json({ ok: true, data, coach })
}
