import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { recomputeTraderScore } from '@/lib/trader-scoring'
import { reviewTrade } from '@/lib/ai-reviews'
import { z } from 'zod'

const journalEntrySchema = z.object({
  pair: z.string().min(1),
  direction: z.enum(['buy', 'sell']),
  entry_price: z.number().optional(),
  exit_price: z.number().optional(),
  lot_size: z.number().positive().optional(),
  pips: z.number().optional(),
  pnl: z.number().optional(),
  risk_amount: z.number().positive().optional(),
  setup_tag: z.string().optional(),
  notes: z.string().optional(),
  screenshot_url: z.string().url().optional(),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Journal v2 extensions
  emotion_pre:    z.enum(['calm','anxious','confident','fomo','fearful','euphoric','angry']).optional(),
  emotion_post:   z.enum(['calm','proud','frustrated','regret','content']).optional(),
  session:        z.enum(['london','new_york','asia','overlap','off_hours']).optional(),
  timeframe:      z.enum(['M5','M15','M30','H1','H4','D1']).optional(),
  market_context: z.enum(['trending','ranging','news','volatile']).optional(),
  mistakes:       z.array(z.string().max(40)).max(8).optional(),
  what_went_well: z.string().max(500).optional(),
  improvements:   z.string().max(500).optional(),
  risk_pct:       z.number().min(0).max(100).optional(),
  rule_violation: z.boolean().optional(),
})

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = journalEntrySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Recompute this trader's composite score (non-blocking)
  if (parsed.data.pnl != null) {
    recomputeTraderScore(createServiceClient(), user.id)
      .catch(err => console.error('Score recompute failed:', err))
  }

  // AI trade review (non-blocking — patches ai_review + ai_score post-insert).
  // Only review trades with enough context to score meaningfully.
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
