import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { computeQualityScore } from '@/lib/signals/quality'

const createSchema = z.object({
  pair: z.string().min(3).max(10).toUpperCase(),
  direction: z.enum(['buy', 'sell']),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit_1: z.number().positive(),
  take_profit_2: z.number().positive().optional(),
  take_profit_3: z.number().positive().optional(),
  risk_reward: z.number().positive().optional(),
  tier_required: z.enum(['free', 'starter', 'premium']).default('starter'),
  strategy_id: z.string().uuid().optional(),
  confidence_score: z.number().int().min(0).max(100).optional(),
  regime: z.enum(['trending','ranging','volatile','dead','breakout','compression']).optional(),
  session: z.enum(['asian','london','new_york','london_ny','off_hours']).optional(),
  admin_notes: z.string().max(500).optional(),
  tags: z.array(z.string()).default([]),
})

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'all'
  const limit = parseInt(searchParams.get('limit') ?? '50')

  let query = db()
    .from('signals')
    .select(`*, strategy:strategy_id (name, display_name)`)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (status !== 'all') query = query.eq('lifecycle_state', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const d = parsed.data

  // Auto-calculate R:R if not provided
  const rr = d.risk_reward ?? (() => {
    const risk = Math.abs(d.entry_price - d.stop_loss)
    const reward = Math.abs(d.take_profit_1 - d.entry_price)
    return risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0
  })()

  // Compute quality score
  const quality = computeQualityScore({
    risk_reward: rr,
    confidence_score: d.confidence_score,
    regime: d.regime,
  })

  const svc = db()
  const { data, error } = await svc
    .from('signals')
    .insert({
      ...d,
      risk_reward: rr,
      quality_score: quality.quality_score,
      lifecycle_state: 'active',
      status: 'active',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log
  await svc.from('audit_logs').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'signal.create',
    resource_type: 'signal',
    resource_id: data.id,
    after_state: data,
  })

  return NextResponse.json({ data }, { status: 201 })
}
