import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { TRADER_TYPES, classify, type ClassificationAnswers } from '@/lib/trader-type'

const HOLD = ['seconds','minutes','hours','days','weeks','months'] as const
const ACTIVITY = ['very_active','active','moderate','passive'] as const
const AUTOMATION = ['manual','semi_auto','fully_auto'] as const
const CAPITAL = ['personal','prop_firm','managed','experiment'] as const

const SaveSchema = z.object({
  // Either: explicit trader_type override (user clicked "actually I'm a swing trader")
  trader_type: z.enum(TRADER_TYPES as [string, ...string[]]).optional(),
  // Or: wizard answers (we'll derive the type)
  answers: z.object({
    hold_duration:  z.enum(HOLD),
    activity:       z.enum(ACTIVITY),
    automation:     z.enum(AUTOMATION),
    capital_source: z.enum(CAPITAL),
  }).optional(),
}).refine(
  (d) => d.trader_type || d.answers,
  { message: 'Provide either trader_type or answers' },
)

/**
 * POST /api/profile/trader-type
 *
 * Persist the user's trader archetype. Caller can either:
 *   - Submit the 4-question wizard `answers` — server derives the type
 *   - Submit an explicit `trader_type` (user overrides the suggestion)
 *
 * The previous answers are always stored on `classification_meta` so
 * we can A/B the classifier later without losing user history.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = SaveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const resolved = parsed.data.trader_type
    ?? classify(parsed.data.answers as ClassificationAnswers)

  const { error } = await supabase
    .from('profiles')
    .update({
      trader_type:         resolved,
      classification_meta: parsed.data.answers ?? {},
      trader_type_set_at:  new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    console.error('trader-type save error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ trader_type: resolved }, { status: 200 })
}
